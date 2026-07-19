/**
 * Pure budget derivation (Rev 2, Phase C1). No Prisma, no I/O — takes plain numbers so
 * it is unit-testable against hand-computed totals.
 *
 * Two scorecards, kept SEPARATE until Phase 6 (you can't add "300 mason-hours" to
 * "BHD 2,500"): a MEASURED side (labour hours by trade + material quantities) derived
 * as `frozen rate × placed quantity`, and a LUMPSUM side (fixed BHD). They never merge
 * into one number in C1.
 */

export type LineType = 'MEASURED' | 'LUMPSUM'

/** Round to a fixed precision to keep float products clean (0.3 × 1000 → 300, not 300.0000001). */
export function round(n: number, dp = 4): number {
  const f = 10 ** dp
  return Math.round((n + Number.EPSILON) * f) / f
}

// ─── Inputs (Decimals already converted to numbers at the DB boundary) ───────────

export interface ManpowerRateInput {
  laborCategoryId: string
  laborCategoryName: string
  hoursPerUnit: number
}
export interface MaterialRateInput {
  materialId: string
  materialName: string
  materialUnit: string
  qtyPerUnit: number
}
export interface SubActivityInput {
  id: string
  name: string
  type: LineType
  isImplicit: boolean
  lumpsumBhd: number | null
  manpower: ManpowerRateInput[]
  materials: MaterialRateInput[]
}
export interface ActivityInput {
  id: string
  ref: string | null
  name: string
  type: LineType
  unit: string | null
  boqQuantity: number
  lumpsumBhd: number | null
  subActivities: SubActivityInput[]
}

// ─── Outputs ─────────────────────────────────────────────────────────────────

export interface ManpowerBudgetLine {
  laborCategoryId: string
  laborCategoryName: string
  hours: number
}
export interface MaterialBudgetLine {
  materialId: string
  materialName: string
  materialUnit: string
  quantity: number
}
export interface BudgetTotals {
  manpower: ManpowerBudgetLine[] // measured side
  materials: MaterialBudgetLine[] // measured side
  lumpsumBhd: number // lumpsum side (fils precision)
}

export interface ActivityBudget {
  activityId: string
  ref: string | null
  name: string
  type: LineType
  unit: string | null
  boqQuantity: number
  totals: BudgetTotals
}
export interface AssetBudget {
  assetId: string
  assetName: string
  activities: ActivityBudget[]
  totals: BudgetTotals
}
export interface ProjectBudget {
  projectId: string
  projectName: string
  assets: AssetBudget[]
  totals: BudgetTotals
}

// ─── Merge helper ────────────────────────────────────────────────────────────

function emptyTotals(): BudgetTotals {
  return { manpower: [], materials: [], lumpsumBhd: 0 }
}

/** Sum a list of totals: manpower by trade, materials by material, BHD added. Sorted by name. */
export function mergeTotals(parts: BudgetTotals[]): BudgetTotals {
  const manpower = new Map<string, ManpowerBudgetLine>()
  const materials = new Map<string, MaterialBudgetLine>()
  let lumpsumBhd = 0
  for (const p of parts) {
    for (const m of p.manpower) {
      const cur = manpower.get(m.laborCategoryId)
      if (cur) cur.hours = round(cur.hours + m.hours)
      else manpower.set(m.laborCategoryId, { ...m })
    }
    for (const m of p.materials) {
      const cur = materials.get(m.materialId)
      if (cur) cur.quantity = round(cur.quantity + m.quantity)
      else materials.set(m.materialId, { ...m })
    }
    lumpsumBhd = round(lumpsumBhd + p.lumpsumBhd, 3)
  }
  return {
    manpower: [...manpower.values()].sort((a, b) => a.laborCategoryName.localeCompare(b.laborCategoryName)),
    materials: [...materials.values()].sort((a, b) => a.materialName.localeCompare(b.materialName)),
    lumpsumBhd,
  }
}

// ─── Derivation ────────────────────────────────────────────────────────────────

/** One reportable line's budget: measured = rate × quantity; lumpsum = fixed BHD. */
export function deriveSubActivityBudget(sub: SubActivityInput, activityQuantity: number): BudgetTotals {
  if (sub.type === 'LUMPSUM') {
    return { manpower: [], materials: [], lumpsumBhd: round(sub.lumpsumBhd ?? 0, 3) }
  }
  return {
    manpower: sub.manpower.map((r) => ({
      laborCategoryId: r.laborCategoryId,
      laborCategoryName: r.laborCategoryName,
      hours: round(r.hoursPerUnit * activityQuantity),
    })),
    materials: sub.materials.map((r) => ({
      materialId: r.materialId,
      materialName: r.materialName,
      materialUnit: r.materialUnit,
      quantity: round(r.qtyPerUnit * activityQuantity),
    })),
    lumpsumBhd: 0,
  }
}

export function deriveActivityBudget(activity: ActivityInput): ActivityBudget {
  let totals: BudgetTotals
  if (activity.type === 'LUMPSUM' && activity.subActivities.length === 0) {
    // Pure lumpsum activity: fixed BHD, no sub-activities.
    totals = { manpower: [], materials: [], lumpsumBhd: round(activity.lumpsumBhd ?? 0, 3) }
  } else {
    // Measured (or mixed) activity: sum its sub-activities, each spanning the activity's quantity.
    totals = mergeTotals(activity.subActivities.map((s) => deriveSubActivityBudget(s, activity.boqQuantity)))
  }
  return {
    activityId: activity.id,
    ref: activity.ref,
    name: activity.name,
    type: activity.type,
    unit: activity.unit,
    boqQuantity: activity.boqQuantity,
    totals,
  }
}

export function deriveAssetBudget(assetId: string, assetName: string, activities: ActivityInput[]): AssetBudget {
  const derived = activities.map(deriveActivityBudget)
  return {
    assetId,
    assetName,
    activities: derived,
    totals: mergeTotals(derived.map((a) => a.totals)),
  }
}

export function deriveProjectBudget(
  projectId: string,
  projectName: string,
  assets: { assetId: string; assetName: string; activities: ActivityInput[] }[],
): ProjectBudget {
  const derived = assets.map((a) => deriveAssetBudget(a.assetId, a.assetName, a.activities))
  return {
    projectId,
    projectName,
    assets: derived,
    totals: mergeTotals(derived.map((a) => a.totals)),
  }
}

export { emptyTotals }
