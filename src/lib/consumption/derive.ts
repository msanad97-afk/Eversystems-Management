/**
 * Pure consumption derivation (Stage 2C-1). No I/O — unit-testable.
 *
 * For one measured sub-activity: expected consumption = budget rate (qtyPerUnit) × quantityDone.
 * STORE EXACT — rounded only to the DB column's 3-dp precision, never to display precision
 * (that would compound daily and corrupt the balance).
 *
 *   - a budget material the supervisor did NOT log → ESTIMATED, quantity = exact rate × qty
 *   - a budget material the supervisor DID log     → ACTUAL, quantity = the typed value
 *     (estimateRate is still recorded, for comparison)
 *   - a logged material with no budget rate        → ACTUAL, no estimateRate
 */

export interface BudgetRate {
  materialId: string
  unit: string
  estimateRate: number // qtyPerUnit — material units per unit of work
}
export interface ActualEntry {
  materialId: string
  unit: string
  quantity: number
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
  actuals: ActualEntry[],
): DerivedConsumption[] {
  const actualByMaterial = new Map(actuals.map((a) => [a.materialId, a]))
  const budgetIds = new Set<string>()
  const out: DerivedConsumption[] = []

  for (const b of budget) {
    budgetIds.add(b.materialId)
    const logged = actualByMaterial.get(b.materialId)
    if (logged) {
      out.push({ materialId: b.materialId, unit: b.unit, quantity: storeExact(logged.quantity), source: 'ACTUAL', estimateRate: b.estimateRate })
    } else {
      out.push({ materialId: b.materialId, unit: b.unit, quantity: storeExact(b.estimateRate * quantityDone), source: 'ESTIMATED', estimateRate: b.estimateRate })
    }
  }

  // Logged materials that aren't in the budget — actual consumption of an unbudgeted material.
  for (const a of actuals) {
    if (!budgetIds.has(a.materialId)) {
      out.push({ materialId: a.materialId, unit: a.unit, quantity: storeExact(a.quantity), source: 'ACTUAL', estimateRate: null })
    }
  }

  return out
}
