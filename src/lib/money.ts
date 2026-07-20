import { round } from '@/lib/budget'

/**
 * Phase 6A — turning budgets into money. Pure, so every figure is hand-checkable.
 *
 * COST budget (BAC):
 *   - measured build-up  = Σ(hoursPerUnit × BOQ × frozen labour rate) + Σ(qtyPerUnit × BOQ × frozen material rate)
 *   - bare measured line = Activity.costRate × BOQ            (fallback when there is no build-up)
 *   - lumpsum line       = lumpsumBhd (a fixed cost)
 *   BAC = Σ measured cost + Σ lumpsum cost  ← the single BHD budget Rev 2 deferred to Phase 6.
 *
 * CONTRACT value (revenue):
 *   - measured = Activity.billRate × BOQ
 *   - lumpsum  = NOTHING. A lumpsum is a cost to complete the activity, never revenue;
 *     billing happens at asset/project level, not on an activity line.
 *
 * A consequence worth stating plainly: a project carrying lumpsum costs with no bill rates
 * set shows a NEGATIVE margin. That is the correct reading — real cost, no revenue recorded
 * against it yet — not a defect.
 *
 * Cost rates are the ones FROZEN onto the budget rows at placement, never the live global
 * catalog rates — so editing a global rate can't re-price a placed project.
 */

const MONEY_DP = 3 // BHD fils
const TOLERANCE = 0.0005

export type CostSource = 'BUILD_UP' | 'RATE_FALLBACK' | 'LUMPSUM' | 'MIXED' | 'NONE'
export type UnpricedKind = 'LABOUR' | 'MATERIAL' | 'ACTIVITY_COST' | 'ACTIVITY_BILL'

export interface UnpricedResource {
  kind: UnpricedKind
  activityId: string
  activityName: string
  resourceId: string | null
  resourceName: string
}

// ─── Inputs ──────────────────────────────────────────────────────────────────

export interface MoneyManpowerLine {
  laborCategoryId: string
  laborCategoryName: string
  hoursPerUnit: number
  costRateAtPlacement: number | null
}
export interface MoneyMaterialLine {
  materialId: string
  materialName: string
  materialUnit: string
  qtyPerUnit: number
  costRateAtPlacement: number | null
}
export interface MoneySubActivity {
  id: string
  name: string
  type: 'MEASURED' | 'LUMPSUM'
  lumpsumBhd: number | null
  manpower: MoneyManpowerLine[]
  materials: MoneyMaterialLine[]
}
export interface MoneyActivity {
  id: string
  ref: string | null
  name: string
  type: 'MEASURED' | 'LUMPSUM'
  unit: string | null
  boqQuantity: number
  lumpsumBhd: number | null
  costRate: number | null
  billRate: number | null
  subActivities: MoneySubActivity[]
}

// ─── Outputs ─────────────────────────────────────────────────────────────────

export interface ActivityMoney {
  activityId: string
  ref: string | null
  name: string
  type: 'MEASURED' | 'LUMPSUM'
  unit: string | null
  boqQuantity: number
  costBudget: number
  contractValue: number
  margin: number
  costSource: CostSource
  unpriced: UnpricedResource[]
}
export interface AssetMoney {
  assetId: string
  assetName: string
  activities: ActivityMoney[]
  costBudget: number
  contractValue: number
  margin: number
}
export interface ProjectMoney {
  projectId: string
  projectName: string
  assets: AssetMoney[]
  bac: number
  contractValue: number
  margin: number
  marginPct: number | null
  unpriced: UnpricedResource[]
  header: {
    budgetCost: number | null
    contractValue: number | null
    costDivergence: number | null // bottom-up − header
    contractDivergence: number | null
    diverged: boolean
  }
}

// ─── Derivation ──────────────────────────────────────────────────────────────

export function deriveActivityMoney(a: MoneyActivity): ActivityMoney {
  const unpriced: UnpricedResource[] = []
  const flag = (kind: UnpricedKind, resourceId: string | null, resourceName: string) =>
    unpriced.push({ kind, activityId: a.id, activityName: a.name, resourceId, resourceName })

  const measuredSubs = a.subActivities.filter((s) => s.type === 'MEASURED')
  const lumpsumSubs = a.subActivities.filter((s) => s.type === 'LUMPSUM')
  const hasBuildUp = measuredSubs.some((s) => s.manpower.length > 0 || s.materials.length > 0)

  // ── measured cost ──
  let measuredCost = 0
  if (hasBuildUp) {
    for (const s of measuredSubs) {
      for (const m of s.manpower) {
        if (m.costRateAtPlacement == null) flag('LABOUR', m.laborCategoryId, m.laborCategoryName)
        else measuredCost += m.hoursPerUnit * a.boqQuantity * m.costRateAtPlacement
      }
      for (const m of s.materials) {
        if (m.costRateAtPlacement == null) flag('MATERIAL', m.materialId, m.materialName)
        else measuredCost += m.qtyPerUnit * a.boqQuantity * m.costRateAtPlacement
      }
    }
  } else if (a.type === 'MEASURED') {
    // Bare measured line (no rate lines) → top-down costRate fallback.
    if (a.costRate == null) flag('ACTIVITY_COST', null, a.name)
    else measuredCost += a.costRate * a.boqQuantity
  }

  // ── lumpsum COST (sub-activities are the source of truth; activity-level only if none) ──
  // Deliberately cost-only: a lumpsum never contributes to contract value.
  let lumpsumCost = 0
  if (lumpsumSubs.length > 0) {
    for (const s of lumpsumSubs) lumpsumCost += s.lumpsumBhd ?? 0
  } else if (a.type === 'LUMPSUM' && a.subActivities.length === 0) {
    lumpsumCost += a.lumpsumBhd ?? 0
  }

  // ── contract value: measured bill rate only, the single source of revenue ──
  let measuredContract = 0
  if (a.type === 'MEASURED') {
    if (a.billRate == null) flag('ACTIVITY_BILL', null, a.name)
    else measuredContract += a.billRate * a.boqQuantity
  }

  const costBudget = round(measuredCost + lumpsumCost, MONEY_DP)
  const contractValue = round(measuredContract, MONEY_DP)

  let costSource: CostSource = 'NONE'
  const hasMeasuredCost = hasBuildUp || (a.type === 'MEASURED' && a.costRate != null)
  const hasLumpsum = lumpsumCost > 0
  if (hasMeasuredCost && hasLumpsum) costSource = 'MIXED'
  else if (hasBuildUp) costSource = 'BUILD_UP'
  else if (hasLumpsum) costSource = 'LUMPSUM'
  else if (a.type === 'MEASURED' && a.costRate != null) costSource = 'RATE_FALLBACK'

  return {
    activityId: a.id, ref: a.ref, name: a.name, type: a.type, unit: a.unit, boqQuantity: a.boqQuantity,
    costBudget, contractValue, margin: round(contractValue - costBudget, MONEY_DP), costSource, unpriced,
  }
}

export function deriveAssetMoney(assetId: string, assetName: string, activities: MoneyActivity[]): AssetMoney {
  const derived = activities.map(deriveActivityMoney)
  const costBudget = round(derived.reduce((s, a) => s + a.costBudget, 0), MONEY_DP)
  const contractValue = round(derived.reduce((s, a) => s + a.contractValue, 0), MONEY_DP)
  return { assetId, assetName, activities: derived, costBudget, contractValue, margin: round(contractValue - costBudget, MONEY_DP) }
}

export function deriveProjectMoney(
  projectId: string,
  projectName: string,
  assets: { assetId: string; assetName: string; activities: MoneyActivity[] }[],
  header: { budgetCost: number | null; contractValue: number | null },
): ProjectMoney {
  const derived = assets.map((a) => deriveAssetMoney(a.assetId, a.assetName, a.activities))
  const bac = round(derived.reduce((s, a) => s + a.costBudget, 0), MONEY_DP)
  const contractValue = round(derived.reduce((s, a) => s + a.contractValue, 0), MONEY_DP)
  const margin = round(contractValue - bac, MONEY_DP)

  const costDivergence = header.budgetCost == null ? null : round(bac - header.budgetCost, MONEY_DP)
  const contractDivergence = header.contractValue == null ? null : round(contractValue - header.contractValue, MONEY_DP)
  const diverged =
    (costDivergence != null && Math.abs(costDivergence) > TOLERANCE) ||
    (contractDivergence != null && Math.abs(contractDivergence) > TOLERANCE)

  return {
    projectId, projectName, assets: derived,
    bac, contractValue, margin,
    marginPct: contractValue > 0 ? round((margin / contractValue) * 100, 1) : null,
    unpriced: derived.flatMap((a) => a.activities.flatMap((x) => x.unpriced)),
    header: { budgetCost: header.budgetCost, contractValue: header.contractValue, costDivergence, contractDivergence, diverged },
  }
}
