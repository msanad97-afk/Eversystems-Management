import { round, type BudgetTotals } from '@/lib/budget'

/**
 * Plan-vs-actual (Phase C2), pure. Actuals are APPROVED-only, rolled up from sub-activity
 * to activity/asset/project. Measured variance compares budget (hours/qty) to actual with
 * a traffic light; lumpsum earned value = % complete × BHD (available now — no lumpsum
 * actual-cost variance until Phase 6). Kept pure so tests hand-check every number.
 *
 * Traffic light (Q3): green < 90% of budget consumed, amber 90–100%, red > 100% (over).
 */

export type Light = 'green' | 'amber' | 'red' | 'none'

export function trafficLight(actual: number, budget: number): Light {
  if (budget <= 0) return actual > 0 ? 'red' : 'none'
  const pct = actual / budget
  if (pct > 1 + 1e-9) return 'red'
  if (pct >= 0.9) return 'amber'
  return 'green'
}

const RANK: Record<Light, number> = { none: 0, green: 1, amber: 2, red: 3 }
export function worstLight(lights: Light[]): Light {
  return lights.reduce<Light>((w, l) => (RANK[l] > RANK[w] ? l : w), 'none')
}

export interface VarianceLine {
  key: string
  name: string
  unit: string | null
  budget: number
  actual: number
  variance: number // budget − actual (positive = under budget)
  consumedPct: number | null // actual / budget × 100 (null when no budget)
  light: Light
}

export function varianceLine(key: string, name: string, unit: string | null, budget: number, actual: number): VarianceLine {
  return {
    key,
    name,
    unit,
    budget: round(budget),
    actual: round(actual),
    variance: round(budget - actual),
    consumedPct: budget > 0 ? round((actual / budget) * 100, 1) : null,
    light: trafficLight(actual, budget),
  }
}

export interface ActualTotals {
  manpower: { laborCategoryId: string; laborCategoryName: string; hours: number }[]
  materials: { materialId: string; materialName: string; materialUnit: string; quantity: number }[]
}

export interface MeasuredVariance {
  labour: VarianceLine[]
  materials: VarianceLine[]
  worstLight: Light
}

/** Compare a budget to its actuals, line by line (labour by trade, materials by material). */
export function buildMeasuredVariance(budget: BudgetTotals, actual: ActualTotals): MeasuredVariance {
  const actLabour = new Map(actual.manpower.map((m) => [m.laborCategoryId, m.hours]))
  const actMat = new Map(actual.materials.map((m) => [m.materialId, m.quantity]))
  // Union of budgeted and actual lines (actuals on an un-budgeted trade still surface, as over-budget).
  const labourIds = new Set([...budget.manpower.map((m) => m.laborCategoryId), ...actLabour.keys()])
  const matIds = new Set([...budget.materials.map((m) => m.materialId), ...actMat.keys()])

  const labourName = new Map<string, string>()
  budget.manpower.forEach((m) => labourName.set(m.laborCategoryId, m.laborCategoryName))
  actual.manpower.forEach((m) => labourName.set(m.laborCategoryId, m.laborCategoryName))
  const matMeta = new Map<string, { name: string; unit: string }>()
  budget.materials.forEach((m) => matMeta.set(m.materialId, { name: m.materialName, unit: m.materialUnit }))
  actual.materials.forEach((m) => matMeta.set(m.materialId, { name: m.materialName, unit: m.materialUnit }))

  const budLabour = new Map(budget.manpower.map((m) => [m.laborCategoryId, m.hours]))
  const budMat = new Map(budget.materials.map((m) => [m.materialId, m.quantity]))

  const labour = [...labourIds]
    .map((id) => varianceLine(id, labourName.get(id) ?? '', 'hrs', budLabour.get(id) ?? 0, actLabour.get(id) ?? 0))
    .sort((a, b) => a.name.localeCompare(b.name))
  const materials = [...matIds]
    .map((id) => varianceLine(id, matMeta.get(id)?.name ?? '', matMeta.get(id)?.unit ?? null, budMat.get(id) ?? 0, actMat.get(id) ?? 0))
    .sort((a, b) => a.name.localeCompare(b.name))

  return { labour, materials, worstLight: worstLight([...labour, ...materials].map((l) => l.light)) }
}

/** Lumpsum earned value = % complete × BHD (fils precision). */
export function lumpsumEarned(percentComplete: number, lumpsumBhd: number): number {
  return round((percentComplete / 100) * lumpsumBhd, 3)
}
