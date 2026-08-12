import { prisma } from '@/lib/prisma'
import type { DeliveryView } from '@/lib/deliveries/types'

/**
 * Delivery read layer. The select is QUANTITIES ONLY — it never touches Material.unitRate or
 * any cost field, so no price can reach a supervisor (or any) delivery view. Unit is read from
 * the line's own snapshot column, never resolved from the catalog at read time.
 */

const deliveryInclude = {
  createdBy: { select: { firstName: true, lastName: true } },
  supplier: { select: { name: true } },
  lines: { orderBy: { id: 'asc' as const }, select: { id: true, materialId: true, quantity: true, unit: true, material: { select: { name: true } } } },
}

interface LoadedDelivery {
  id: string
  supplierName: string
  supplier: { name: string } | null
  deliveryNoteNumber: string
  attachmentUrl: string | null
  notes: string | null
  createdBy: { firstName: string; lastName: string }
  lines: { id: string; materialId: string; quantity: unknown; unit: string; material: { name: string } }[]
}

export function toDeliveryView(d: LoadedDelivery): DeliveryView {
  return {
    id: d.id,
    // Prefer the live supplier relation; fall back to the frozen snapshot for older rows.
    supplierName: d.supplier?.name ?? d.supplierName,
    deliveryNoteNumber: d.deliveryNoteNumber,
    hasAttachment: d.attachmentUrl != null,
    notes: d.notes,
    createdBy: `${d.createdBy.firstName} ${d.createdBy.lastName}`,
    lines: d.lines.map((l) => ({ id: l.id, materialId: l.materialId, materialName: l.material.name, quantity: Number(l.quantity), unit: l.unit })),
  }
}

/** All deliveries on a report, oldest first, as quantities-only views. */
export async function loadReportDeliveries(reportId: string): Promise<DeliveryView[]> {
  const rows = await prisma.delivery.findMany({
    where: { dailyReportId: reportId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, supplierName: true, deliveryNoteNumber: true, attachmentUrl: true, notes: true,
      ...deliveryInclude,
    },
  })
  return rows.map((r) => toDeliveryView(r as LoadedDelivery))
}

/** A single delivery view (or null), for a create response. */
export async function loadDelivery(id: string): Promise<DeliveryView | null> {
  const row = await prisma.delivery.findUnique({
    where: { id },
    select: {
      id: true, supplierName: true, deliveryNoteNumber: true, attachmentUrl: true, notes: true,
      ...deliveryInclude,
    },
  })
  return row ? toDeliveryView(row as LoadedDelivery) : null
}
