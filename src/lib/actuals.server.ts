import { prisma } from '@/lib/prisma'
import { loadProjectBudget } from '@/lib/budget.server'
import { cumulativePercent } from '@/lib/reports/rules'
import {
  buildMeasuredVariance,
  lumpsumEarned,
  worstLight,
  type MeasuredVariance,
  type ActualTotals,
  type Light,
  type VarianceLine,
} from '@/lib/actuals'
import { round } from '@/lib/budget'

export interface ActivityBVA {
  activityId: string
  ref: string | null
  name: string
  type: 'MEASURED' | 'LUMPSUM'
  unit: string | null
  boqQuantity: number
  physicalPercent: number
  measured: MeasuredVariance
  lumpsumBudgetBhd: number
  lumpsumEarnedBhd: number
  lumpsumPercent: number
  worstLight: Light
}
export interface AssetBVA {
  assetId: string
  assetName: string
  activities: ActivityBVA[]
}
export interface ProjectBudgetVsActual {
  projectId: string
  projectName: string
  assets: AssetBVA[]
  totals: {
    labour: VarianceLine[]
    materials: VarianceLine[]
    lumpsumBudgetBhd: number
    lumpsumEarnedBhd: number
    physicalPercent: number
    worstLight: Light
  }
}

/** Man-hours (headcount×hours) by trade + material qty by material, for a set of rows. */
function accumulate(target: {
  labour: Map<string, { name: string; hours: number }>
  materials: Map<string, { name: string; unit: string; quantity: number }>
}, row: {
  manpower: { headcount: number; hours: unknown; category: { id: string; name: string } }[]
  materials: { quantity: unknown; material: { id: string; name: string; unit: string } }[]
}) {
  for (const m of row.manpower) {
    const cur = target.labour.get(m.category.id) ?? { name: m.category.name, hours: 0 }
    cur.hours += m.headcount * Number(m.hours)
    target.labour.set(m.category.id, cur)
  }
  for (const m of row.materials) {
    const cur = target.materials.get(m.material.id) ?? { name: m.material.name, unit: m.material.unit, quantity: 0 }
    cur.quantity += Number(m.quantity)
    target.materials.set(m.material.id, cur)
  }
}
function toActualTotals(t: {
  labour: Map<string, { name: string; hours: number }>
  materials: Map<string, { name: string; unit: string; quantity: number }>
}): ActualTotals {
  return {
    manpower: [...t.labour.entries()].map(([id, v]) => ({ laborCategoryId: id, laborCategoryName: v.name, hours: round(v.hours) })),
    materials: [...t.materials.entries()].map(([id, v]) => ({ materialId: id, materialName: v.name, materialUnit: v.unit, quantity: round(v.quantity) })),
  }
}
function emptyAccum() {
  return { labour: new Map<string, { name: string; hours: number }>(), materials: new Map<string, { name: string; unit: string; quantity: number }>() }
}

/**
 * Budget-vs-actual rollup for a project. Actuals are APPROVED-only. Measured lines get a
 * budget/actual/variance + traffic light per trade/material; lumpsum activities get earned
 * value (% × BHD). Physical % is the mean of an activity's measured sub-activities' %.
 */
export async function loadBudgetVsActual(projectId: string): Promise<ProjectBudgetVsActual | null> {
  const budget = await loadProjectBudget(projectId)
  if (!budget) return null

  // All active activities + their active sub-activities (for physical % and lumpsum earned).
  const activities = await prisma.activity.findMany({
    where: { isActive: true, asset: { projectId, isActive: true } },
    select: {
      id: true, boqQuantity: true,
      subActivities: { where: { isActive: true }, select: { id: true, type: true, lumpsumBhd: true } },
    },
  })

  // APPROVED reported rows for the project (actuals + earned + latest lumpsum %).
  const rows = await prisma.reportSubActivity.findMany({
    where: { reportActivity: { report: { projectId, status: 'APPROVED' } } },
    orderBy: [{ reportActivity: { report: { reportDate: 'desc' } } }, { id: 'desc' }],
    select: {
      subActivityId: true,
      quantityDone: true,
      percentComplete: true,
      subActivity: { select: { activityId: true } },
      manpower: { select: { headcount: true, hours: true, category: { select: { id: true, name: true } } } },
      materials: { select: { quantity: true, material: { select: { id: true, name: true, unit: true } } } },
    },
  })

  const actualByActivity = new Map<string, ReturnType<typeof emptyAccum>>()
  const earnedBySub = new Map<string, number>() // measured Σ quantityDone
  const latestPctBySub = new Map<string, number>() // lumpsum: rows are date-desc, first wins
  for (const r of rows) {
    const actId = r.subActivity.activityId
    if (!actualByActivity.has(actId)) actualByActivity.set(actId, emptyAccum())
    accumulate(actualByActivity.get(actId)!, r)
    if (r.quantityDone != null) earnedBySub.set(r.subActivityId, (earnedBySub.get(r.subActivityId) ?? 0) + Number(r.quantityDone))
    if (r.percentComplete != null && !latestPctBySub.has(r.subActivityId)) latestPctBySub.set(r.subActivityId, Number(r.percentComplete))
  }

  const physicalByActivity = new Map<string, number>()
  const lumpsumEarnedByActivity = new Map<string, number>()
  for (const a of activities) {
    const boq = Number(a.boqQuantity)
    const measuredSubs = a.subActivities.filter((s) => s.type === 'MEASURED')
    const lumpsumSubs = a.subActivities.filter((s) => s.type === 'LUMPSUM')
    if (measuredSubs.length > 0) {
      const mean = measuredSubs.reduce((sum, s) => sum + cumulativePercent(earnedBySub.get(s.id) ?? 0, boq), 0) / measuredSubs.length
      physicalByActivity.set(a.id, round(mean, 2))
    }
    if (lumpsumSubs.length > 0) {
      const earned = lumpsumSubs.reduce((sum, s) => sum + lumpsumEarned(latestPctBySub.get(s.id) ?? 0, s.lumpsumBhd ? Number(s.lumpsumBhd) : 0), 0)
      lumpsumEarnedByActivity.set(a.id, round(earned, 3))
    }
  }

  const emptyActual: ActualTotals = { manpower: [], materials: [] }
  const assets: AssetBVA[] = budget.assets.map((asset) => ({
    assetId: asset.assetId,
    assetName: asset.assetName,
    activities: asset.activities.map((act) => {
      const accum = actualByActivity.get(act.activityId)
      const actual = accum ? toActualTotals(accum) : emptyActual
      const measured = buildMeasuredVariance(act.totals, actual)
      const lumpsumBudgetBhd = act.totals.lumpsumBhd
      const lumpsumEarnedBhd = lumpsumEarnedByActivity.get(act.activityId) ?? 0
      const lumpsumPercent = lumpsumBudgetBhd > 0 ? round((lumpsumEarnedBhd / lumpsumBudgetBhd) * 100, 1) : 0
      return {
        activityId: act.activityId,
        ref: act.ref,
        name: act.name,
        type: act.type,
        unit: act.unit,
        boqQuantity: act.boqQuantity,
        physicalPercent: physicalByActivity.get(act.activityId) ?? 0,
        measured,
        lumpsumBudgetBhd,
        lumpsumEarnedBhd,
        lumpsumPercent,
        worstLight: measured.worstLight,
      }
    }),
  }))

  // Project totals: variance against the project-level budget + summed actuals.
  const projActual = emptyAccum()
  for (const accum of actualByActivity.values()) {
    for (const [id, v] of accum.labour) {
      const cur = projActual.labour.get(id) ?? { name: v.name, hours: 0 }
      cur.hours += v.hours
      projActual.labour.set(id, cur)
    }
    for (const [id, v] of accum.materials) {
      const cur = projActual.materials.get(id) ?? { name: v.name, unit: v.unit, quantity: 0 }
      cur.quantity += v.quantity
      projActual.materials.set(id, cur)
    }
  }
  const projMeasured = buildMeasuredVariance(budget.totals, toActualTotals(projActual))
  const physVals = [...physicalByActivity.values()]
  const physicalPercent = physVals.length > 0 ? round(physVals.reduce((s, p) => s + p, 0) / physVals.length, 2) : 0
  const lumpsumEarnedBhdTotal = round([...lumpsumEarnedByActivity.values()].reduce((s, v) => s + v, 0), 3)

  return {
    projectId: budget.projectId,
    projectName: budget.projectName,
    assets,
    totals: {
      labour: projMeasured.labour,
      materials: projMeasured.materials,
      lumpsumBudgetBhd: budget.totals.lumpsumBhd,
      lumpsumEarnedBhd: lumpsumEarnedBhdTotal,
      physicalPercent,
      worstLight: worstLight(assets.flatMap((a) => a.activities.map((x) => x.worstLight))),
    },
  }
}
