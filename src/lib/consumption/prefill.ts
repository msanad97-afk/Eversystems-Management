import { formatConsumptionQty } from '@/lib/consumption/format'

/**
 * Pre-fill material-row quantities with the derived estimate (Stage 2C-1), DISPLAY-rounded.
 * Only UNtouched budget rows are (re)filled — a row the supervisor typed into (touched) is never
 * overwritten. Recompute this whenever quantity-done changes. The exact value is recomputed on
 * the server at submit; the display value here only needs to satisfy the "> 0" validation.
 */

export interface PrefillRow {
  materialId: string
  quantity: string
  touched?: boolean
}
export interface PrefillBudget {
  materialId: string
  unit: string
  qtyPerUnit: number
}

export function applyEstimatePrefill<T extends PrefillRow>(rows: T[], budget: PrefillBudget[], quantityDone: number): T[] {
  const budgetByMaterial = new Map(budget.map((b) => [b.materialId, b]))
  return rows.map((r) => {
    if (r.touched) return r // never overwrite a typed value
    const b = r.materialId ? budgetByMaterial.get(r.materialId) : undefined
    if (!b) return r // not a budget material → no estimate to fill
    return { ...r, quantity: quantityDone > 0 ? formatConsumptionQty(b.qtyPerUnit * quantityDone, b.unit) : '' }
  })
}
