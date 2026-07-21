import { prisma } from '@/lib/prisma'
import { loadProjectMoney } from '@/lib/money.server'
import { deriveSubActivityBudgets, type MoneyActivity } from '@/lib/money'
import { loadProjectCostPerformance } from '@/lib/cost.server'
import {
  computeEvm, computeEvmCostOnly, measuredPercent, lumpsumPercent, earnedValue,
  plannedValue, interpolateCumPct, monthRange, monthEnd,
  MONEY_DP, type BaselinePoint, type EvmMetrics, type EvmCostMetrics,
} from '@/lib/evm'
import { round } from '@/lib/budget'

/**
 * Phase 6C — EVM derivation. Reads only APPROVED reports; `reportDate` (the work date, and
 * the indexed column) is the clock for as-of filtering and monthly buckets, so value lands
 * in the month the work happened rather than the month someone signed it off.
 *
 * Roll-up is always ratio-of-sums: EV/BV/AC are summed up sub → activity → asset → project
 * and the indices recomputed at each level. Child indices are never averaged.
 */

export interface EvmNode extends EvmCostMetrics {
  id: string
  name: string
  ref?: string | null
}
export interface SeriesPoint {
  month: string
  pvCum: number | null
  evCum: number
  acCum: number
}
export interface ProjectEvm extends EvmMetrics {
  projectId: string
  projectName: string
  asOf: string
  level: 'project'
  hasBaseline: boolean
  expensesTotal: number
  contractValue: number
  projectedMargin: number
  // Data-quality signals carried through from 6A/6B so EVM is never read in isolation.
  unpricedCount: number
  hasApproximations: boolean
  approximatedCost: number
  assets: EvmNode[]
  series: SeriesPoint[]
}
export interface ActivityEvmLevel {
  projectId: string
  asOf: string
  level: 'activity'
  assetId: string
  assetName: string
  activities: EvmNode[]
}

const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))

interface SubRow {
  subActivityId: string
  activityId: string
  assetId: string
  assetName: string
  activityName: string
  activityRef: string | null
  bv: number
  type: 'MEASURED' | 'LUMPSUM'
  plannedQty: number
}

/** BV per sub-activity + the asset/activity tree, from the 6A money model. */
async function loadScope(projectId: string): Promise<{ subs: SubRow[]; assetOrder: { id: string; name: string }[] }> {
  const assets = await prisma.asset.findMany({
    where: { projectId, isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true, name: true,
      activities: {
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true, ref: true, name: true, type: true, unit: true, boqQuantity: true,
          lumpsumBhd: true, costRate: true, billRate: true,
          subActivities: {
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
            select: {
              id: true, name: true, type: true, lumpsumBhd: true,
              manpowerBudget: { select: { hoursPerUnit: true, costRateAtPlacement: true, category: { select: { id: true, name: true } } } },
              materialBudget: { select: { qtyPerUnit: true, costRateAtPlacement: true, material: { select: { id: true, name: true, unit: true } } } },
            },
          },
        },
      },
    },
  })

  const subs: SubRow[] = []
  for (const asset of assets) {
    for (const a of asset.activities) {
      const input: MoneyActivity = {
        id: a.id, ref: a.ref, name: a.name, type: a.type, unit: a.unit,
        boqQuantity: Number(a.boqQuantity),
        lumpsumBhd: a.lumpsumBhd == null ? null : Number(a.lumpsumBhd),
        costRate: a.costRate == null ? null : Number(a.costRate),
        billRate: a.billRate == null ? null : Number(a.billRate),
        subActivities: a.subActivities.map((s) => ({
          id: s.id, name: s.name, type: s.type,
          lumpsumBhd: s.lumpsumBhd == null ? null : Number(s.lumpsumBhd),
          manpower: s.manpowerBudget.map((b) => ({
            laborCategoryId: b.category.id, laborCategoryName: b.category.name,
            hoursPerUnit: Number(b.hoursPerUnit),
            costRateAtPlacement: b.costRateAtPlacement == null ? null : Number(b.costRateAtPlacement),
          })),
          materials: s.materialBudget.map((b) => ({
            materialId: b.material.id, materialName: b.material.name, materialUnit: b.material.unit,
            qtyPerUnit: Number(b.qtyPerUnit),
            costRateAtPlacement: b.costRateAtPlacement == null ? null : Number(b.costRateAtPlacement),
          })),
        })),
      }
      for (const bvRow of deriveSubActivityBudgets(input)) {
        subs.push({
          subActivityId: bvRow.subActivityId,
          activityId: a.id,
          assetId: asset.id,
          assetName: asset.name,
          activityName: a.name,
          activityRef: a.ref,
          bv: bvRow.bv,
          type: bvRow.type,
          plannedQty: Number(a.boqQuantity),
        })
      }
    }
  }
  return { subs, assetOrder: assets.map((a) => ({ id: a.id, name: a.name })) }
}

interface ProgressRow {
  subActivityId: string
  reportDate: Date
  quantityDone: number | null
  percentComplete: number | null
  cost: number
}

/** Approved progress + snapshot cost, dated by reportDate. One query. */
async function loadApprovedProgress(projectId: string, asOf: Date): Promise<ProgressRow[]> {
  const rows = await prisma.reportSubActivity.findMany({
    where: {
      reportActivity: { report: { projectId, status: 'APPROVED', reportDate: { lte: asOf } } },
    },
    select: {
      subActivityId: true,
      quantityDone: true,
      percentComplete: true,
      reportActivity: { select: { report: { select: { reportDate: true } } } },
      manpower: { select: { costAtApproval: true } },
      materials: { select: { costAtApproval: true } },
    },
  })
  return rows.map((r) => ({
    subActivityId: r.subActivityId,
    reportDate: r.reportActivity.report.reportDate,
    quantityDone: r.quantityDone == null ? null : Number(r.quantityDone),
    percentComplete: r.percentComplete == null ? null : Number(r.percentComplete),
    cost: round(
      r.manpower.reduce((s, m) => s + (m.costAtApproval == null ? 0 : Number(m.costAtApproval)), 0) +
        r.materials.reduce((s, m) => s + (m.costAtApproval == null ? 0 : Number(m.costAtApproval)), 0),
      MONEY_DP,
    ),
  }))
}

/** EV and AC per sub-activity as of a cut-off, from already-loaded rows. */
function evAcAsOf(subs: SubRow[], progress: ProgressRow[], cutoff: Date) {
  const qty = new Map<string, number>()
  const latestPct = new Map<string, { at: number; pct: number }>()
  const ac = new Map<string, number>()

  for (const p of progress) {
    if (p.reportDate.getTime() > cutoff.getTime()) continue
    if (p.quantityDone != null) qty.set(p.subActivityId, (qty.get(p.subActivityId) ?? 0) + p.quantityDone)
    if (p.percentComplete != null) {
      // Cumulative, not summed — keep the value from the latest reportDate.
      const prev = latestPct.get(p.subActivityId)
      if (!prev || p.reportDate.getTime() >= prev.at) latestPct.set(p.subActivityId, { at: p.reportDate.getTime(), pct: p.percentComplete })
    }
    if (p.cost > 0) ac.set(p.subActivityId, round((ac.get(p.subActivityId) ?? 0) + p.cost, MONEY_DP))
  }

  const evBySub = new Map<string, number>()
  for (const s of subs) {
    const pct = s.type === 'LUMPSUM'
      ? lumpsumPercent(latestPct.get(s.subActivityId)?.pct ?? null)
      : measuredPercent(qty.get(s.subActivityId) ?? 0, s.plannedQty)
    evBySub.set(s.subActivityId, earnedValue(s.bv, pct))
  }
  return { evBySub, acBySub: ac }
}

async function loadBaselinePoints(projectId: string): Promise<BaselinePoint[]> {
  const rows = await prisma.baselinePeriod.findMany({
    where: { projectId },
    orderBy: { periodMonth: 'asc' },
    select: { periodMonth: true, cumPlannedPct: true },
  })
  return rows.map((r) => ({ periodMonth: r.periodMonth.toISOString().slice(0, 10), cumPlannedPct: Number(r.cumPlannedPct) }))
}

export async function loadProjectEvm(projectId: string, asOfInput?: Date): Promise<ProjectEvm | null> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, startDate: true, plannedStart: true } })
  if (!project) return null

  const asOf = utcDay(asOfInput ?? new Date())
  const [{ subs, assetOrder }, progress, baseline, money, costPerf] = await Promise.all([
    loadScope(projectId),
    loadApprovedProgress(projectId, asOf),
    loadBaselinePoints(projectId),
    loadProjectMoney(projectId),
    loadProjectCostPerformance(projectId),
  ])

  const { evBySub, acBySub } = evAcAsOf(subs, progress, asOf)
  const sum = (f: (s: SubRow) => number) => round(subs.reduce((t, s) => t + f(s), 0), MONEY_DP)
  const bac = sum((s) => s.bv)
  const ev = sum((s) => evBySub.get(s.subActivityId) ?? 0)
  const ac = sum((s) => acBySub.get(s.subActivityId) ?? 0)
  const pv = plannedValue(baseline, asOf, bac)

  const metrics = computeEvm({ bac, pv, ev, ac })

  // ── asset roll-up (cost metrics only — no per-asset baseline exists) ──
  const assets: EvmNode[] = assetOrder.map((a) => {
    const inAsset = subs.filter((s) => s.assetId === a.id)
    const node = computeEvmCostOnly({
      bac: round(inAsset.reduce((t, s) => t + s.bv, 0), MONEY_DP),
      ev: round(inAsset.reduce((t, s) => t + (evBySub.get(s.subActivityId) ?? 0), 0), MONEY_DP),
      ac: round(inAsset.reduce((t, s) => t + (acBySub.get(s.subActivityId) ?? 0), 0), MONEY_DP),
    })
    return { id: a.id, name: a.name, ...node }
  })

  // ── historical series, monthly, by reportDate ──
  const firstReport = progress.length > 0 ? progress.reduce((m, p) => (p.reportDate < m ? p.reportDate : m), progress[0]!.reportDate) : null
  const candidates = [
    baseline.length > 0 ? new Date(`${baseline[0]!.periodMonth}T00:00:00.000Z`) : null,
    firstReport,
    project.startDate,
    project.plannedStart,
  ].filter((d): d is Date => d instanceof Date)
  const seriesStart = candidates.length > 0 ? new Date(Math.min(...candidates.map((d) => d.getTime()))) : asOf
  const series: SeriesPoint[] = monthRange(seriesStart, asOf).map((month) => {
    const cutoffRaw = monthEnd(month)
    const cutoff = cutoffRaw.getTime() > asOf.getTime() ? asOf : cutoffRaw
    const { evBySub: e, acBySub: a } = evAcAsOf(subs, progress, cutoff)
    const pct = interpolateCumPct(baseline, cutoff)
    return {
      month,
      pvCum: pct == null ? null : round((pct / 100) * bac, MONEY_DP),
      evCum: round(subs.reduce((t, s) => t + (e.get(s.subActivityId) ?? 0), 0), MONEY_DP),
      acCum: round(subs.reduce((t, s) => t + (a.get(s.subActivityId) ?? 0), 0), MONEY_DP),
    }
  })

  // ── total project economics (6C.5): direct EAC + overhead vs contract value ──
  const expensesTotal = costPerf?.expenses.eligibleTotal ?? 0
  const contractValue = money?.contractValue ?? 0

  return {
    projectId: project.id,
    projectName: project.name,
    asOf: asOf.toISOString().slice(0, 10),
    level: 'project',
    hasBaseline: baseline.length > 0,
    ...metrics,
    expensesTotal,
    contractValue,
    projectedMargin: round(contractValue - metrics.eac - expensesTotal, MONEY_DP),
    unpricedCount: (money?.unpriced.length ?? 0) + (costPerf?.unpriced.length ?? 0),
    hasApproximations: costPerf?.hasApproximations ?? false,
    approximatedCost: costPerf?.approximatedCost ?? 0,
    assets,
    series,
  }
}

/** Activity-level drill inside one asset (same per-node cost shape). */
export async function loadActivityEvm(projectId: string, assetId: string, asOfInput?: Date): Promise<ActivityEvmLevel | null> {
  const asset = await prisma.asset.findFirst({ where: { id: assetId, projectId }, select: { id: true, name: true } })
  if (!asset) return null

  const asOf = utcDay(asOfInput ?? new Date())
  const [{ subs }, progress] = await Promise.all([loadScope(projectId), loadApprovedProgress(projectId, asOf)])
  const { evBySub, acBySub } = evAcAsOf(subs, progress, asOf)

  const inAsset = subs.filter((s) => s.assetId === assetId)
  const byActivity = new Map<string, SubRow[]>()
  for (const s of inAsset) byActivity.set(s.activityId, [...(byActivity.get(s.activityId) ?? []), s])

  const activities: EvmNode[] = [...byActivity.entries()].map(([activityId, rows]) => ({
    id: activityId,
    name: rows[0]!.activityName,
    ref: rows[0]!.activityRef,
    ...computeEvmCostOnly({
      bac: round(rows.reduce((t, s) => t + s.bv, 0), MONEY_DP),
      ev: round(rows.reduce((t, s) => t + (evBySub.get(s.subActivityId) ?? 0), 0), MONEY_DP),
      ac: round(rows.reduce((t, s) => t + (acBySub.get(s.subActivityId) ?? 0), 0), MONEY_DP),
    }),
  }))

  return { projectId, asOf: asOf.toISOString().slice(0, 10), level: 'activity', assetId: asset.id, assetName: asset.name, activities }
}

// ─── Portfolio (ACTIVE projects only) ─────────────────────────────────────────

export interface PortfolioEvm {
  asOf: string
  projects: { projectId: string; projectCode: string; projectName: string; bac: number; pv: number | null; ev: number; ac: number; spi: number | null; cpi: number | null; eac: number; vac: number; pctComplete: number }[]
  totals: { bac: number; pv: number; ev: number; ac: number; spi: number | null; cpi: number | null }
}

export async function loadPortfolioEvm(asOfInput?: Date): Promise<PortfolioEvm> {
  const asOf = utcDay(asOfInput ?? new Date())
  // ACTIVE only — completed/on-hold work would dilute the signal about current performance.
  const projects = await prisma.project.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { projectCode: 'asc' },
    select: { id: true, projectCode: true, name: true },
  })

  const rows = []
  let bac = 0, pvSum = 0, ev = 0, ac = 0
  for (const p of projects) {
    const e = await loadProjectEvm(p.id, asOf)
    if (!e) continue
    rows.push({
      projectId: p.id, projectCode: p.projectCode, projectName: p.name,
      bac: e.bac, pv: e.pv, ev: e.ev, ac: e.ac, spi: e.spi, cpi: e.cpi, eac: e.eac, vac: e.vac, pctComplete: e.pctComplete,
    })
    bac += e.bac
    ev += e.ev
    ac += e.ac
    if (e.pv != null) pvSum += e.pv // projects without a baseline contribute nothing to company SPI
  }

  return {
    asOf: asOf.toISOString().slice(0, 10),
    projects: rows,
    totals: {
      bac: round(bac, MONEY_DP),
      pv: round(pvSum, MONEY_DP),
      ev: round(ev, MONEY_DP),
      ac: round(ac, MONEY_DP),
      spi: pvSum > 0 ? round(ev / pvSum, 4) : null,
      cpi: ac > 0 ? round(ev / ac, 4) : null,
    },
  }
}
