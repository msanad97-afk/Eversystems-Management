import { prisma } from '@/lib/prisma'
import { loadProjectEvm } from '@/lib/evm.server'
import { loadBudgetVsActual, type SubActivityProgress } from '@/lib/actuals.server'
import { lumpsumFloorBySubActivity } from '@/lib/reports/progress'
import { cumulativePercent } from '@/lib/reports/rules'

/**
 * Project breakdown for the admin project page AND the Phase C weekly PDF — the loader is the
 * deliverable, the screen its first consumer. ONE money block at project level plus a per-ACTIVITY
 * progress MATRIX: one table per active activity, assets as rows, that activity's sub-activities as
 * columns, cumulative % in the cells and the weighted physical % in a final total column.
 *
 * Reuse only — NO second EVM or progress computation:
 *   - project money + value-weighted completion (EV/BAC) come from loadProjectEvm (evm.server).
 *   - each cell % and the weighted total per placement come from loadBudgetVsActual (actuals.server),
 *     which uses the weightedActivityPercent added in 0a7a18f/7ae617d. The total column is exactly
 *     that activity's physicalPercent — it CANNOT differ from the panel figure, both read this map.
 *     The money in that budget-vs-actual result is DISCARDED; no cost crosses into the matrix.
 *
 * GROUPING: an "activity" spans assets — the same activity (by name) placed on several assets becomes
 * one table with a row per asset. Its sub-activities are snapshotted per placement, so different
 * assets may carry different subs (a SPARSE grid). Columns are the UNION of the non-implicit subs by
 * name (implicit lines never surface); a sub absent from an asset's placement is a null cell that the
 * UI renders as a dash — distinct from a real 0%.
 *
 * RECENT PROGRESS: a cell rising in the last 7 days is flagged with its delta. The 7-days-ago
 * baseline is each sub's cumulative % from APPROVED reports dated on or before asOf =
 * UTC-midnight(today) − 7 days — measured: cumulativePercent(Σ earned) over an as-of query; lumpsum:
 * lumpsumFloorBySubActivity(asOf), the shared as-of lookup (so it never reads latest-overall).
 * delta = current − baseline; flagged only when it increased.
 *
 * Inactive assets and activities are excluded.
 */

export interface MatrixColumn {
  key: string // sub-activity name — the column identity across placements
  name: string
  type: 'MEASURED' | 'LUMPSUM'
  weightPct: number // resolved weight from the shared resolver (read-only here)
}
export interface MatrixCell {
  percent: number
  delta: number | null // increase over the last 7 days; null = did not rise
}
export interface MatrixRow {
  assetId: string
  assetName: string
  assetRef: string | null
  boqQuantity: number
  unit: string | null
  cells: (MatrixCell | null)[] // aligned to columns; null = sub not in this asset's scope (absent)
  totalPercent: number // the placement's weighted physical % (reused, not recomputed)
  totalDelta: number | null
}
export interface ActivityMatrix {
  key: string
  name: string
  ref: string | null
  columns: MatrixColumn[]
  rows: MatrixRow[]
}
export interface ProjectOverview {
  project: {
    name: string
    code: string
    contractValue: number
    bac: number
    ev: number
    ac: number
    cv: number
    cpi: number | null
    eac: number
    vac: number
    physicalPercent: number // weighted physical progress (mean of activity %s)
    valuePercent: number // EV / BAC × 100 — value-weighted completion
  }
  matrix: ActivityMatrix[]
}

const round1 = (n: number) => Math.round(n * 10) / 10
const DELTA_TOL = 0.05

export async function loadProjectOverview(projectId: string): Promise<ProjectOverview | null> {
  // Baseline boundary: reports dated on or before asOf = UTC-midnight(today) − 7 days count as the
  // "7 days ago" state; anything dated after it is a rise within the window.
  const now = new Date()
  const asOf = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 7))

  const [project, evm, bva, assetRefs, measuredBaselineRows] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { name: true, projectCode: true } }),
    loadProjectEvm(projectId),
    loadBudgetVsActual(projectId),
    prisma.asset.findMany({ where: { projectId, isActive: true }, select: { id: true, ref: true } }),
    // Measured Σ earned as of the baseline date. Lumpsum baseline comes from the shared as-of lookup.
    prisma.reportSubActivity.groupBy({
      by: ['subActivityId'],
      where: { quantityDone: { not: null }, reportActivity: { report: { projectId, status: 'APPROVED', reportDate: { lte: asOf } } } },
      _sum: { quantityDone: true },
    }),
  ])
  if (!project || !evm) return null

  const refByAsset = new Map(assetRefs.map((a) => [a.id, a.ref]))

  // Baseline accumulators: measured Σ earned ≤ asOf; lumpsum latest approved % ≤ asOf (shared lookup,
  // so the matrix and the dashboard read lumpsum as-of the same way — never latest-overall).
  const baseEarnedBySub = new Map(measuredBaselineRows.map((r) => [r.subActivityId, Number(r._sum.quantityDone ?? 0)]))
  const lumpsumSubIds = (bva?.assets ?? []).flatMap((a) => a.activities.flatMap((act) => act.subProgress.filter((s) => s.type === 'LUMPSUM').map((s) => s.subActivityId)))
  const baseLatestPctBySub = await lumpsumFloorBySubActivity(lumpsumSubIds, asOf)
  const baselinePct = (sp: SubActivityProgress, boq: number): number =>
    sp.type === 'MEASURED' ? cumulativePercent(baseEarnedBySub.get(sp.subActivityId) ?? 0, boq) : (baseLatestPctBySub.get(sp.subActivityId) ?? 0)

  // Group activity placements across assets by activity name.
  interface Placement { assetId: string; assetName: string; assetRef: string | null; boq: number; unit: string | null; total: number; subs: SubActivityProgress[] }
  const groups = new Map<string, { name: string; ref: string | null; placements: Placement[] }>()
  for (const asset of bva?.assets ?? []) {
    for (const act of asset.activities) {
      let g = groups.get(act.name)
      if (!g) { g = { name: act.name, ref: act.ref, placements: [] }; groups.set(act.name, g) }
      if (g.ref == null && act.ref != null) g.ref = act.ref
      g.placements.push({
        assetId: asset.assetId,
        assetName: asset.assetName,
        assetRef: refByAsset.get(asset.assetId) ?? null,
        boq: act.boqQuantity,
        unit: act.unit,
        total: act.physicalPercent,
        subs: act.subProgress,
      })
    }
  }

  const matrix: ActivityMatrix[] = [...groups.values()].map((g) => {
    // Columns = union of non-implicit subs by name, ordered by sortOrder then name. Weight is taken
    // from the first placement carrying the sub (placements snapshot the same catalogue → they agree).
    const colByName = new Map<string, { name: string; type: 'MEASURED' | 'LUMPSUM'; weightPct: number; sortOrder: number }>()
    for (const pl of g.placements) {
      for (const sp of pl.subs) {
        if (sp.isImplicit) continue
        const ex = colByName.get(sp.name)
        if (!ex) colByName.set(sp.name, { name: sp.name, type: sp.type, weightPct: sp.weightPct, sortOrder: sp.sortOrder })
        else ex.sortOrder = Math.min(ex.sortOrder, sp.sortOrder)
      }
    }
    const columns: MatrixColumn[] = [...colByName.values()]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map((c) => ({ key: c.name, name: c.name, type: c.type, weightPct: round1(c.weightPct) }))

    const rows: MatrixRow[] = g.placements.map((pl) => {
      const subByName = new Map(pl.subs.map((sp) => [sp.name, sp]))
      const cells: (MatrixCell | null)[] = columns.map((col) => {
        const sp = subByName.get(col.key)
        if (!sp) return null // absent from this asset's scope — dash, not zero
        const rise = sp.percent - baselinePct(sp, pl.boq)
        return { percent: round1(sp.percent), delta: rise > DELTA_TOL ? round1(rise) : null }
      })
      // Total delta: weighted baseline (resolved weights) vs the reused weighted total.
      const sumW = pl.subs.reduce((s, sp) => s + sp.weightPct, 0)
      const baseTotal = sumW > 0
        ? pl.subs.reduce((s, sp) => s + baselinePct(sp, pl.boq) * sp.weightPct, 0) / sumW
        : (pl.subs.length > 0 ? pl.subs.reduce((s, sp) => s + baselinePct(sp, pl.boq), 0) / pl.subs.length : 0)
      const totalRise = pl.total - baseTotal
      return {
        assetId: pl.assetId,
        assetName: pl.assetName,
        assetRef: pl.assetRef,
        boqQuantity: pl.boq,
        unit: pl.unit,
        cells,
        totalPercent: round1(pl.total),
        totalDelta: totalRise > DELTA_TOL ? round1(totalRise) : null,
      }
    })

    return { key: g.name, name: g.name, ref: g.ref, columns, rows }
  })

  return {
    project: {
      name: project.name,
      code: project.projectCode,
      contractValue: evm.contractValue,
      bac: evm.bac,
      ev: evm.ev,
      ac: evm.ac,
      cv: evm.cv,
      cpi: evm.cpi,
      eac: evm.eac,
      vac: evm.vac,
      physicalPercent: bva?.totals.physicalPercent ?? 0,
      valuePercent: evm.pctComplete,
    },
    matrix,
  }
}
