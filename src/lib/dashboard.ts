import type { ReportStatus } from '@prisma/client'

/**
 * Dashboard aggregation (Part 4.9). Pure functions — no I/O — so every number is
 * unit-testable and there's a single source of truth. The API route fetches raw rows
 * and hands them here.
 *
 * COUNTING RULE (spec checklist): only SUBMITTED and APPROVED reports are counted;
 * DRAFT and REJECTED are excluded everywhere. Filtering happens inside these functions
 * so callers can pass a mixed set and the exclusion is guaranteed + tested.
 */

export const COUNTED_STATUSES: ReportStatus[] = ['SUBMITTED', 'APPROVED']
export function isCounted(status: ReportStatus): boolean {
  return COUNTED_STATUSES.includes(status)
}

export interface DashManpower {
  categoryName: string
  headcount: number
  hours: number
}
export interface DashMaterial {
  materialName: string
  unit: string
  quantity: number
}
export interface DashReport {
  projectId: string
  reportDate: string // YYYY-MM-DD (civil)
  status: ReportStatus
  manpower: DashManpower[]
  materials: DashMaterial[]
}
export interface DashProject {
  id: string
  projectCode: string
  name: string
}

export interface DashboardInput {
  reports: DashReport[] // reports whose reportDate is within [from, to]
  from: string // YYYY-MM-DD
  to: string // YYYY-MM-DD
  activeProjects: DashProject[] // active projects in scope (respecting a project filter)
  todayReports: DashReport[] // reports dated "today" (app tz), in scope
  yesterdayReportedProjectIds: string[] // project ids with a counted report dated "yesterday"
}

export interface ManHoursDayRow {
  date: string
  byCategory: Record<string, number>
  total: number
}
export interface DashboardResult {
  kpis: {
    reportsSubmitted: number
    reportsExpected: number
    totalManHours: number
    activeWorkersToday: number
  }
  manHoursPerDay: {
    days: string[]
    categories: string[]
    rows: ManHoursDayRow[]
    max: number
  }
  materialTotals: { materialName: string; unit: string; total: number }[]
  missingYesterday: { projectCode: string; name: string }[]
}

// ─── Physical progress (Phase 4, resumed) ────────────────────────────────────
// Progress by asset/activity + a project physical %. Earned = APPROVED-only quantity
// (as of the range end date); % = earned/BOQ capped at 100. The single project physical
// % is the UNWEIGHTED average of its activities' %s (units differ, and value/cost rates
// are Phase 6); it upgrades to value-weighted (billRate) once rates exist.

export interface ProgressRow {
  projectId: string
  projectCode: string
  projectName: string
  assetId: string
  assetName: string
  activityId: string
  ref: string | null
  name: string
  unit: string
  boqQuantity: number
  earned: number
}
export interface ProgressActivity {
  activityId: string
  ref: string | null
  name: string
  unit: string
  boqQuantity: number
  earned: number
  percent: number
  remaining: number
}
export interface ProgressAsset {
  assetId: string
  assetName: string
  activities: ProgressActivity[]
}
export interface ProjectProgress {
  projectId: string
  projectCode: string
  projectName: string
  physicalPercent: number
  activityCount: number
  assets: ProgressAsset[]
}

function pctOf(earned: number, boq: number): number {
  return boq > 0 ? Math.min(100, (earned / boq) * 100) : 0
}

/**
 * Groups flat activity-earned rows (already ordered project → asset → activity) into a
 * per-project progress tree. Physical % = unweighted mean of the project's activity %s.
 */
export function aggregateProgress(rows: ProgressRow[]): ProjectProgress[] {
  const projects = new Map<string, ProjectProgress>()
  for (const r of rows) {
    let p = projects.get(r.projectId)
    if (!p) {
      p = { projectId: r.projectId, projectCode: r.projectCode, projectName: r.projectName, physicalPercent: 0, activityCount: 0, assets: [] }
      projects.set(r.projectId, p)
    }
    let a = p.assets.find((x) => x.assetId === r.assetId)
    if (!a) {
      a = { assetId: r.assetId, assetName: r.assetName, activities: [] }
      p.assets.push(a)
    }
    a.activities.push({
      activityId: r.activityId, ref: r.ref, name: r.name, unit: r.unit,
      boqQuantity: r.boqQuantity, earned: r.earned,
      percent: pctOf(r.earned, r.boqQuantity),
      remaining: Math.max(0, r.boqQuantity - r.earned),
    })
  }
  for (const p of projects.values()) {
    const acts = p.assets.flatMap((a) => a.activities)
    p.activityCount = acts.length
    p.physicalPercent = acts.length > 0 ? acts.reduce((s, x) => s + x.percent, 0) / acts.length : 0
  }
  return [...projects.values()]
}

/** Inclusive list of civil dates from `from` to `to`. Empty if from > to. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = []
  const start = new Date(`${from}T00:00:00.000Z`).getTime()
  const end = new Date(`${to}T00:00:00.000Z`).getTime()
  if (Number.isNaN(start) || Number.isNaN(end) || start > end) return out
  for (let t = start; t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}

function manHours(m: DashManpower): number {
  if (!Number.isFinite(m.headcount) || !Number.isFinite(m.hours)) return 0
  return m.headcount * m.hours
}

export function aggregateDashboard(input: DashboardInput): DashboardResult {
  const counted = input.reports.filter((r) => isCounted(r.status))
  const days = eachDay(input.from, input.to)

  // ─── Coverage: distinct (project, date) with a counted report vs active-project-days ───
  const coveredProjectDays = new Set(counted.map((r) => `${r.projectId}|${r.reportDate}`))
  const reportsExpected = input.activeProjects.length * days.length

  // ─── Total man-hours (range) ───
  let totalManHours = 0
  for (const r of counted) for (const m of r.manpower) totalManHours += manHours(m)

  // ─── Active workers today ───
  let activeWorkersToday = 0
  for (const r of input.todayReports.filter((r) => isCounted(r.status))) {
    for (const m of r.manpower) activeWorkersToday += Number.isFinite(m.headcount) ? m.headcount : 0
  }

  // ─── Man-hours per day, stacked by category ───
  const dayMap = new Map<string, Record<string, number>>()
  const categorySet = new Set<string>()
  for (const d of days) dayMap.set(d, {})
  for (const r of counted) {
    const bucket = dayMap.get(r.reportDate)
    if (!bucket) continue // report outside the day list (shouldn't happen if caller scoped correctly)
    for (const m of r.manpower) {
      const mh = manHours(m)
      if (mh === 0) continue
      categorySet.add(m.categoryName)
      bucket[m.categoryName] = (bucket[m.categoryName] ?? 0) + mh
    }
  }
  const categories = [...categorySet].sort((a, b) => a.localeCompare(b))
  let max = 0
  const rows: ManHoursDayRow[] = days.map((date) => {
    const byCategory = dayMap.get(date) ?? {}
    const total = Object.values(byCategory).reduce((s, v) => s + v, 0)
    if (total > max) max = total
    return { date, byCategory, total }
  })

  // ─── Material totals (range) ───
  const matMap = new Map<string, { materialName: string; unit: string; total: number }>()
  for (const r of counted) {
    for (const m of r.materials) {
      const key = `${m.materialName}|${m.unit}`
      const cur = matMap.get(key) ?? { materialName: m.materialName, unit: m.unit, total: 0 }
      cur.total += Number.isFinite(m.quantity) ? m.quantity : 0
      matMap.set(key, cur)
    }
  }
  const materialTotals = [...matMap.values()].sort((a, b) =>
    a.materialName.localeCompare(b.materialName),
  )

  // ─── Missing-report alert: active projects with no counted report yesterday ───
  const reportedYesterday = new Set(input.yesterdayReportedProjectIds)
  const missingYesterday = input.activeProjects
    .filter((p) => !reportedYesterday.has(p.id))
    .map((p) => ({ projectCode: p.projectCode, name: p.name }))

  return {
    kpis: {
      reportsSubmitted: coveredProjectDays.size,
      reportsExpected,
      totalManHours,
      activeWorkersToday,
    },
    manHoursPerDay: { days, categories, rows, max },
    materialTotals,
    missingYesterday,
  }
}
