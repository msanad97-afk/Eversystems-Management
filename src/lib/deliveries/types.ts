// Shared delivery types (client + server). QUANTITIES ONLY — no rate/cost/value/price field
// exists on any of these shapes. The money wall holds across every delivery path.

export interface DeliveryLineView {
  id: string
  materialId: string
  materialName: string
  quantity: number
  unit: string
}
export interface DeliveryView {
  id: string
  supplierName: string
  deliveryNoteNumber: string
  hasAttachment: boolean
  notes: string | null
  createdBy: string
  lines: DeliveryLineView[]
}

export interface DeliveryLineInput {
  materialId: string
  quantity: number
  unit: string
}
export interface DeliveryInput {
  supplierName: string
  deliveryNoteNumber: string
  notes?: string | null
  lines: DeliveryLineInput[]
}

/** Validate a delivery: supplier + note number required; ≥1 line; each material once; qty > 0. */
export function validateDeliveryInput(d: DeliveryInput): string | null {
  if (!d.supplierName || !d.supplierName.trim()) return 'Supplier is required.'
  if (!d.deliveryNoteNumber || !d.deliveryNoteNumber.trim()) return 'Delivery note number is required.'
  if (!d.lines || d.lines.length === 0) return 'Add at least one material line.'
  const seen = new Set<string>()
  for (const l of d.lines) {
    if (!l.materialId) return 'Each line needs a material.'
    if (seen.has(l.materialId)) return 'A material can appear only once per delivery.'
    seen.add(l.materialId)
    if (!(l.quantity > 0)) return 'Each quantity must be greater than zero.'
  }
  return null
}
