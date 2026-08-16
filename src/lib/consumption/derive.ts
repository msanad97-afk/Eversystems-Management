/**
 * Pure consumption derivation (Stage 2C-1). No I/O — unit-testable.
 *
 * For one measured sub-activity: expected consumption = budget rate (qtyPerUnit) × quantityDone.
 * STORE EXACT — rounded only to the DB column's 3-dp precision, never to display precision
 * (that would compound daily and corrupt the balance).
 *
 * A material row's `touched` flag (persisted on MaterialEntry) decides the source:
 *   - a budget material that is UNtouched (or has no row) → ESTIMATED; the quantity is the
 *     SERVER-recomputed exact rate × quantityDone (never the stored rounded display value)
 *   - a budget material that is TOUCHED                   → ACTUAL, the stored typed value
 *     (estimateRate is still recorded, for comparison)
 *   - a logged material with no budget rate               → ACTUAL, no estimateRate
 */

export interface BudgetRate {
  materialId: string
  unit: string
  estimateRate: number // qtyPerUnit — material units per unit of work
}
export interface MaterialEntryInput {
  materialId: string
  unit: string
  quantity: number
  touched: boolean
}
export interface DerivedConsumption {
  materialId: string
  unit: string
  quantity: number
  source: 'ACTUAL' | 'ESTIMATED'
  estimateRate: number | null
}

/** Round to the ConsumptionEntry column precision (3 dp) — the exact storage boundary, no display rounding. */
export function storeExact(n: number): number {
  return Math.round(n * 1000) / 1000
}

export function deriveSubConsumption(
  quantityDone: number,
  budget: BudgetRate[],
  entries: MaterialEntryInput[],
): DerivedConsumption[] {
  const entryByMaterial = new Map(entries.map((e) => [e.materialId, e]))
  const budgetIds = new Set<string>()
  const out: DerivedConsumption[] = []

  for (const b of budget) {
    budgetIds.add(b.materialId)
    const entry = entryByMaterial.get(b.materialId)
    if (entry && entry.touched) {
      out.push({ materialId: b.materialId, unit: b.unit, quantity: storeExact(entry.quantity), source: 'ACTUAL', estimateRate: b.estimateRate })
    } else {
      // Untouched (or no row): recompute the EXACT estimate — ignore any stored rounded display.
      out.push({ materialId: b.materialId, unit: b.unit, quantity: storeExact(b.estimateRate * quantityDone), source: 'ESTIMATED', estimateRate: b.estimateRate })
    }
  }

  // Logged materials that aren't in the budget — actual consumption of an unbudgeted material.
  for (const e of entries) {
    if (!budgetIds.has(e.materialId)) {
      out.push({ materialId: e.materialId, unit: e.unit, quantity: storeExact(e.quantity), source: 'ACTUAL', estimateRate: null })
    }
  }

  return out
}
