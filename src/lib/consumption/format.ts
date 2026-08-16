/**
 * Display rounding for consumption quantities (Stage 2C-1). STORAGE stays exact — this is
 * DISPLAY only, and the single shared source of the rule so it never drifts across components:
 *   - countable units (bag, roll, drum, sheet, ea, …) → whole units
 *   - continuous units (kg, litre, m², m³, …)          → one decimal
 * Quantities only — no cost anywhere.
 */

// Singular forms; matching also tolerates a trailing plural "s".
const COUNTABLE_UNITS = new Set([
  'bag', 'roll', 'drum', 'sheet', 'ea', 'each', 'pc', 'pcs', 'piece', 'no', 'nos',
  'unit', 'box', 'bundle', 'coil', 'can', 'tin', 'bar', 'pallet', 'set',
])

export function isCountableUnit(unit: string): boolean {
  const u = unit.trim().toLowerCase()
  if (COUNTABLE_UNITS.has(u)) return true
  return u.endsWith('s') && COUNTABLE_UNITS.has(u.slice(0, -1))
}

/** Format a quantity for display: whole for countable units, one decimal otherwise. */
export function formatConsumptionQty(qty: number, unit: string): string {
  if (isCountableUnit(unit)) return String(Math.round(qty))
  return String(Math.round(qty * 10) / 10)
}
