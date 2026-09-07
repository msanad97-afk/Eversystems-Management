import { prisma } from '@/lib/prisma'
import { round } from '@/lib/budget'
import { startOfAppDay, addDays } from '@/lib/datetime'
import { loadProjectOverview, type ActivityMatrix } from '@/lib/projectOverview.server'
import { loadCashPosition, loadReceivables } from '@/lib/cash.server'
import { loadOpenAlerts, type AlertView } from '@/lib/deliveries/alertsView.server'
import { listValuations } from '@/lib/valuation.server'
import { lumpsumFloorBySubActivity } from '@/lib/reports/progress'
import { weightedActivityPercent } from '@/lib/progress/weights'
import { cumulativePercent } from '@/lib/reports/rules'

/**
 * Phase C — the weekly management summary. ONE data loader feeding both the PDF (cron + on-demand)
 * and its tests. It is ASSEMBLY, not new analysis: money and progress are reused from
 * loadProjectOverview (which owns the single EVM pass), cash from loadCashPosition, receivables from
 * loadReceivables, alerts from loadOpenAlerts, valuations from listValuations. The only computation
 * added here is the week-on-week physical-% MOVEMENT, built from the 1f2b8da as-of machinery
 * (weightedActivityPercent + cumulativePercent + the as-of lumpsum lookup) — never a second EVM.
 *
 * THE WEEK is a fixed Sunday→Saturday boundary in Bahrain civil time. The Sunday 08:00 send covers
 * the week that ended the day before, so the covered dates are stamped on the document.
 */

const round1 = (n: number) => Math.round(n * 10) / 10

// ─── Week boundary (Sunday → Saturday, Bahrain civil) ─────────────────────────

export interface WeekBoundary {
  start: Date // the covered week's Sunday (UTC-midnight civil)
  end: Date // the covered week's Saturday
  startStr: string
  endStr: string
  key: string // idempotency key = the Sunday's date
  label: string // human-readable span for the document
}

/**
 * The most recently COMPLETED Sunday→Saturday week relative to `instant` (Bahrain civil). Run on a
 * Sunday it is [last Sunday, yesterday-Saturday]; run mid-week it is the previous complete week — so
 * the on-demand document matches what the Sunday cron would send.
 */
export function weekBoundary(instant: Date = new Date()): WeekBoundary {
  const todayMid = startOfAppDay(instant) // Bahrain civil midnight, UTC-represented
  const dow = todayMid.getUTCDay() // 0=Sun … 6=Sat
  const end = addDays(todayMid, -(dow + 1)) // the Saturday that ended the last complete week
  const start = addDays(end, -6) // that week's Sunday
  const startStr = start.toISOString().slice(0, 10)
  const endStr = end.toISOString().slice(0, 10)
  const fmt = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  return { start, end, startStr, endStr, key: startStr, label: `${fmt(start)} – ${fmt(end)}` }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WeeklyProjectPage {
  id: string
  name: string
  code: string
  money: { contractValue: number; bac: number; ev: number; ac: number; cv: number; cpi: number | null; eac: number; vac: number }
  physicalPercent: number
  valuePercent: number
  movement: number // physical-% change across the covered week
  hadActivityThisWeek: boolean
  manHoursWeek: number
  manHoursCumulative: number
  hasOpeningBalance: boolean // an approved opening report exists → cumulative man-hours are understated
  deliveriesWeek: number
  certifiedToDate: number
  outstandingReceivables: number
  openAlerts: number
  matrix: ActivityMatrix[]
}

export interface WeeklyFlags {
  missedReports: { name: string; daysMissed: number }[]
  negativeBalances: AlertView[]
  countVariances: AlertView[]
  otherAlerts: AlertView[]
  anyFlag: boolean
}

export interface WeeklyPortfolioRow {
  id: string
  name: string
  physicalPercent: number
  valuePercent: number
  movement: number
}

export interface WeeklySummaryData {
  week: WeekBoundary
  generatedAt: string
  portfolio: {
    activeProjectCount: number
    totalContractValue: number
    totalBac: number
    totalActualCost: number
    cashClearedBalance: number
    cashProjectedBalance: number
    outstandingReceivables: number
    reportsFiled: number
    reportsExpected: number
    workingDaysNote: string
    rows: WeeklyPortfolioRow[]
    flags: WeeklyFlags
  }
  projects: WeeklyProjectPage[]
}

// ─── Movement (week-on-week physical %, as-of machinery) ──────────────────────

type PhysActivity = { boqQuantity: unknown; subActivities: { id: string; type: string; weightPct: unknown }[] }

/** Project physical % as of a date, reusing the SAME weighted mean actuals.server produces. */
function physicalPercentFrom(activities: PhysActivity[], earnedBySub: Map<string, number>, lumpsumPct: Map<string, number>): number {
  const vals: number[] = []
  for (const a of activities) {
    if (a.subActivities.length === 0) continue
    const boq = Number(a.boqQuantity)
    const subs = a.subActivities.map((s) => ({ id: s.id, type: s.type as 'MEASURED' | 'LUMPSUM', weightPct: s.weightPct == null ? null : Number(s.weightPct) }))
    const pctById = new Map(subs.map((s) => [s.id, s.type === 'MEASURED' ? cumulativePercent(earnedBySub.get(s.id) ?? 0, boq) : (lumpsumPct.get(s.id) ?? 0)]))
    vals.push(round(weightedActivityPercent(subs, pctById), 2))
  }
  return vals.length > 0 ? round(vals.reduce((s, p) => s + p, 0) / vals.length, 2) : 0
}

/** Movement across the covered week = physical %(end) − physical %(day before start). */
async function weekMovement(projectId: string, start: Date, end: Date): Promise<{ movement: number; anyEarnedInWeek: boolean }> {
  const before = addDays(start, -1)
  const activities = await prisma.activity.findMany({
    where: { isActive: true, asset: { projectId, isActive: true } },
    select: { boqQuantity: true, subActivities: { where: { isActive: true }, select: { id: true, type: true, weightPct: true } } },
  })
  const subIds = activities.flatMap((a) => a.subActivities.map((s) => s.id))
  const lumpsumIds = activities.flatMap((a) => a.subActivities.filter((s) => s.type === 'LUMPSUM').map((s) => s.id))
  const earnedAsOf = (asOf: Date) =>
    subIds.length === 0
      ? Promise.resolve([] as { subActivityId: string; _sum: { quantityDone: unknown } }[])
      : prisma.reportSubActivity.groupBy({
          by: ['subActivityId'],
          where: { subActivityId: { in: subIds }, quantityDone: { not: null }, reportActivity: { report: { projectId, status: 'APPROVED', reportDate: { lte: asOf } } } },
          _sum: { quantityDone: true },
        })

  const [earnEnd, earnStart, lumpEnd, lumpStart] = await Promise.all([
    earnedAsOf(end), earnedAsOf(before), lumpsumFloorBySubActivity(lumpsumIds, end), lumpsumFloorBySubActivity(lumpsumIds, before),
  ])
  const mapEnd = new Map(earnEnd.map((r) => [r.subActivityId, Number(r._sum.quantityDone ?? 0)]))
  const mapStart = new Map(earnStart.map((r) => [r.subActivityId, Number(r._sum.quantityDone ?? 0)]))
  const physEnd = physicalPercentFrom(activities, mapEnd, lumpEnd)
  const physStart = physicalPercentFrom(activities, mapStart, lumpStart)
  // "Activity in the week" = any measured earned or lumpsum % rose between the two as-of points.
  const anyEarnedInWeek = [...mapEnd].some(([id, v]) => v !== (mapStart.get(id) ?? 0)) || [...lumpEnd].some(([id, v]) => v !== (lumpStart.get(id) ?? 0))
  return { movement: round1(physEnd - physStart), anyEarnedInWeek }
}

// ─── Per-project weekly operational figures ───────────────────────────────────

async function projectWeekOps(projectId: string, start: Date, end: Date): Promise<{ manHoursWeek: number; manHoursCumulative: number; deliveriesWeek: number }> {
  const manRows = (where: object) => prisma.manpowerEntry.findMany({ where: { reportSubActivity: { reportActivity: { report: { projectId, status: 'APPROVED', ...where } } } }, select: { headcount: true, hours: true } })
  const [week, cumulative, deliveriesWeek] = await Promise.all([
    manRows({ reportDate: { gte: start, lte: end } }),
    manRows({ reportDate: { lte: end } }),
    prisma.delivery.count({ where: { dailyReport: { projectId, status: 'APPROVED', reportDate: { gte: start, lte: end } } } }),
  ])
  const sumMh = (rows: { headcount: number; hours: unknown }[]) => round1(rows.reduce((s, r) => s + r.headcount * Number(r.hours), 0))
  return { manHoursWeek: sumMh(week), manHoursCumulative: sumMh(cumulative), deliveriesWeek }
}

// ─── The loader ───────────────────────────────────────────────────────────────

export async function loadWeeklySummary(opts: { instant?: Date } = {}): Promise<WeeklySummaryData> {
  const week = weekBoundary(opts.instant)
  const { start, end } = week
  const generatedAt = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Bahrain', dateStyle: 'medium', timeStyle: 'short' })

  const [activeProjects, cash, receivables, openAlerts, weekReports, openingReports] = await Promise.all([
    prisma.project.findMany({ where: { status: 'ACTIVE' }, orderBy: { projectCode: 'asc' }, select: { id: true, name: true, projectCode: true } }),
    loadCashPosition(),
    loadReceivables({ today: end }),
    loadOpenAlerts(),
    // Any-status counts as filed (matches the daily missing-report sweep).
    prisma.dailyReport.findMany({ where: { reportDate: { gte: start, lte: end }, project: { status: 'ACTIVE' } }, select: { projectId: true, reportDate: true } }),
    // Projects whose cumulative man-hours are understated by an approved opening balance.
    prisma.dailyReport.findMany({ where: { isOpeningBalance: true, status: 'APPROVED', project: { status: 'ACTIVE' } }, select: { projectId: true }, distinct: ['projectId'] }),
  ])
  const openingBalanceProjects = new Set(openingReports.map((r) => r.projectId))

  // Outstanding receivables (money still to collect) per project + total.
  const outstandingByProject = new Map<string, number>()
  for (const r of receivables) if (r.outstanding > 0) outstandingByProject.set(r.projectId, round((outstandingByProject.get(r.projectId) ?? 0) + r.outstanding, 3))
  const outstandingReceivables = round([...outstandingByProject.values()].reduce((s, v) => s + v, 0), 3)

  // Reports filed this week = distinct (project, date); expected = active projects × 7 calendar days.
  // The app has NO working-day model — the daily sweep expects a report every calendar day — so we
  // count calendar days and say so.
  const filedPairs = new Set(weekReports.map((r) => `${r.projectId}:${r.reportDate.toISOString().slice(0, 10)}`))
  const daysFiledByProject = new Map<string, Set<string>>()
  for (const r of weekReports) {
    const set = daysFiledByProject.get(r.projectId) ?? new Set<string>()
    set.add(r.reportDate.toISOString().slice(0, 10))
    daysFiledByProject.set(r.projectId, set)
  }
  const WEEK_DAYS = 7
  const reportsExpected = activeProjects.length * WEEK_DAYS

  const missedReports = activeProjects
    .map((p) => ({ name: p.name, daysMissed: WEEK_DAYS - (daysFiledByProject.get(p.id)?.size ?? 0) }))
    .filter((m) => m.daysMissed > 0)

  const negativeBalances = openAlerts.filter((a) => a.type === 'NEGATIVE_BALANCE')
  const countVariances = openAlerts.filter((a) => a.type === 'COUNT_VARIANCE')
  const otherAlerts = openAlerts.filter((a) => a.type !== 'NEGATIVE_BALANCE' && a.type !== 'COUNT_VARIANCE')
  const flags: WeeklyFlags = {
    missedReports, negativeBalances, countVariances, otherAlerts,
    anyFlag: missedReports.length > 0 || openAlerts.length > 0,
  }

  // Open-alert counts per project (by name — the alert view exposes projectName).
  const alertCountByProject = new Map<string, number>()
  for (const a of openAlerts) alertCountByProject.set(a.projectName, (alertCountByProject.get(a.projectName) ?? 0) + 1)

  // Per project: reuse loadProjectOverview (money + matrix + physical/value %), add movement + ops.
  const projects: WeeklyProjectPage[] = []
  for (const p of activeProjects) {
    const [overview, mv, ops, valuations] = await Promise.all([
      loadProjectOverview(p.id),
      weekMovement(p.id, start, end),
      projectWeekOps(p.id, start, end),
      listValuations(p.id),
    ])
    if (!overview) continue // a project with no money context still shouldn't crash the batch
    const certifiedToDate = valuations.filter((v) => v.status === 'CERTIFIED').reduce((max, v) => Math.max(max, v.grossAmount), 0)
    projects.push({
      id: p.id,
      name: overview.project.name,
      code: overview.project.code,
      money: {
        contractValue: overview.project.contractValue, bac: overview.project.bac, ev: overview.project.ev, ac: overview.project.ac,
        cv: overview.project.cv, cpi: overview.project.cpi, eac: overview.project.eac, vac: overview.project.vac,
      },
      physicalPercent: overview.project.physicalPercent,
      valuePercent: overview.project.valuePercent,
      movement: mv.movement,
      hadActivityThisWeek: mv.anyEarnedInWeek || ops.manHoursWeek > 0 || ops.deliveriesWeek > 0,
      manHoursWeek: ops.manHoursWeek,
      manHoursCumulative: ops.manHoursCumulative,
      hasOpeningBalance: openingBalanceProjects.has(p.id),
      deliveriesWeek: ops.deliveriesWeek,
      certifiedToDate: round(certifiedToDate, 3),
      outstandingReceivables: outstandingByProject.get(p.id) ?? 0,
      openAlerts: alertCountByProject.get(overview.project.name) ?? 0,
      matrix: overview.matrix,
    })
  }

  const totalContractValue = round(projects.reduce((s, p) => s + p.money.contractValue, 0), 3)
  const totalBac = round(projects.reduce((s, p) => s + p.money.bac, 0), 3)
  const totalActualCost = round(projects.reduce((s, p) => s + p.money.ac, 0), 3)

  return {
    week,
    generatedAt,
    portfolio: {
      activeProjectCount: activeProjects.length,
      totalContractValue, totalBac, totalActualCost,
      cashClearedBalance: cash.totals.clearedBalance,
      cashProjectedBalance: cash.totals.projectedBalance,
      outstandingReceivables,
      reportsFiled: filedPairs.size,
      reportsExpected,
      workingDaysNote: 'Expected = active projects × 7 calendar days (a report is expected every day; the app has no working-day model).',
      rows: projects.map((p) => ({ id: p.id, name: p.name, physicalPercent: p.physicalPercent, valuePercent: p.valuePercent, movement: p.movement })),
      flags,
    },
    projects,
  }
}
