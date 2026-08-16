import { formatConsumptionQty } from '@/lib/consumption/format'

/**
 * Aggregate the estimated-consumption summary shown in the submit confirmation. One row per
 * MATERIAL — quantities summed across all reported sub-activities (a material budgeted on two
 * sub-activities is ONE summary row, even though the ledger keeps two rows for traceability).
 * `anyTouched` reports whether the supervisor edited any consumption row.
 */

export interface SummarySubInput {
  type: 'MEASURED' | 'LUMPSUM'
  quantityDone: number
  anyTouched: boolean
  budgetMaterials: { materialId: string; materialName: string; unit: string; qtyPerUnit: number }[]
}
export interface SummaryRow {
  materialId: string
  name: string
  quantity: string // display-rounded
  unit: string
}

export function aggregateConsumptionSummary(subs: SummarySubInput[]): { rows: SummaryRow[]; anyTouched: boolean } {
  const byMaterial = new Map<string, { name: string; unit: string; qty: number }>()
  let anyTouched = false
  for (const s of subs) {
    if (s.type !== 'MEASURED' || !(s.quantityDone > 0)) continue
    if (s.anyTouched) anyTouched = true
    for (const bm of s.budgetMaterials) {
      const cur = byMaterial.get(bm.materialId) ?? { name: bm.materialName, unit: bm.unit, qty: 0 }
      cur.qty += bm.qtyPerUnit * s.quantityDone
      byMaterial.set(bm.materialId, cur)
    }
  }
  const rows: SummaryRow[] = [...byMaterial.entries()]
    .map(([materialId, m]) => ({ materialId, name: m.name, quantity: formatConsumptionQty(m.qty, m.unit), unit: m.unit }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return { rows, anyTouched }
}
