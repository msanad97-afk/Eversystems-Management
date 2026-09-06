import { prisma } from '@/lib/prisma'
import { loadProjectEvm } from '@/lib/evm.server'
import { loadBudgetVsActual } from '@/lib/actuals.server'

/**
 * Project breakdown for the admin project page AND the Phase C weekly PDF — the loader is the
 * deliverable, the screen its first consumer. ONE money block at project level plus a money-FREE
 * asset → activity tree of physical progress.
 *
 * Reuse only — NO second EVM or progress computation:
 *   - project money + value-weighted completion (EV/BAC) come from loadProjectEvm (evm.server).
 *   - weighted physical % per activity comes from loadBudgetVsActual (actuals.server), which itself
 *     uses the weightedActivityPercent added in 0a7a18f/7ae617d (measured earned/boq + lumpsum
 *     cumulative %). The money in that budget-vs-actual result is DISCARDED here; only physicalPercent
 *     crosses the project boundary.
 *   - the asset → activity structure is a light active-only query (labels + BOQ, no cost).
 *
 * Asset physical % is the UNWEIGHTED MEAN of its active activities' physical %s. That is the only
 * money-free aggregation available below project level — a value- or BOQ-weighted mean would need a
 * cost figure or a common unit across activities, and neither is permitted here — and it is
 * consistent with how the project physical % is itself the mean of activity %s.
 *
 * Inactive assets and activities are excluded.
 */

export interface OverviewActivity {
  ref: string | null
  name: string
  unit: string | null
  boqQuantity: number
  physicalPercent: number
}
export interface OverviewAsset {
  name: string
  ref: string | null
  physicalPercent: number
  activities: OverviewActivity[]
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
  assets: OverviewAsset[]
}

const round1 = (n: number) => Math.round(n * 10) / 10

export async function loadProjectOverview(projectId: string): Promise<ProjectOverview | null> {
  const [project, evm, bva, assetRows] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { name: true, projectCode: true } }),
    loadProjectEvm(projectId),
    loadBudgetVsActual(projectId),
    prisma.asset.findMany({
      where: { projectId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true, ref: true, name: true,
        activities: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          select: { id: true, ref: true, name: true, unit: true, boqQuantity: true },
        },
      },
    }),
  ])
  if (!project || !evm) return null

  // Weighted physical % per activity, taken from the reused budget-vs-actual result (money dropped).
  const pctByActivity = new Map<string, number>()
  for (const a of bva?.assets ?? []) for (const act of a.activities) pctByActivity.set(act.activityId, act.physicalPercent)

  const assets: OverviewAsset[] = assetRows.map((asset) => {
    const activities: OverviewActivity[] = asset.activities.map((act) => ({
      ref: act.ref,
      name: act.name,
      unit: act.unit,
      boqQuantity: Number(act.boqQuantity),
      physicalPercent: pctByActivity.get(act.id) ?? 0,
    }))
    const physicalPercent = activities.length > 0 ? round1(activities.reduce((s, a) => s + a.physicalPercent, 0) / activities.length) : 0
    return { name: asset.name, ref: asset.ref, physicalPercent, activities }
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
    assets,
  }
}
