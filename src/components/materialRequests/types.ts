// Shared client types for the material-request UI. Quantities only — no cost ever crosses here.

export interface MatOption {
  id: string
  name: string
  unit: string
  isActive: boolean
}
export interface ActivityScopeOption {
  id: string
  ref: string | null
  name: string
}
export interface AssetScopeOption {
  id: string
  name: string
  activities: ActivityScopeOption[]
}
export interface ProjectScopeOption {
  id: string
  name: string
  projectCode: string
  assets: AssetScopeOption[]
}
/** Server-computed budget signal for one material at the chosen scope (mirrors MaterialSignal). */
export interface MaterialSignal {
  materialId: string
  materialName: string
  unit: string
  budgetedQty: number | null
  requestedSoFar: number
  pending: number
}
export interface ExistingRequest {
  id: string
  projectId: string
  assetId: string | null
  activityId: string | null
  lines: { materialId: string; requestedQty: number; note: string | null }[]
}

/** Quantity display: trim to at most 3 dp, drop trailing zeros ("500", "6.5", "6.25"). */
export function fmtQty(n: number): string {
  return String(Math.round(n * 1000) / 1000)
}
