import { prisma } from '@/lib/prisma'

/** Management-facing view of an inventory alert. ADMIN-only surface; no cost fields. */
export interface AlertView {
  id: string
  type: 'MISSING_ATTACHMENT' | 'COUNT_VARIANCE' | 'NEGATIVE_BALANCE'
  projectName: string
  materialName: string | null
  quantity: number | null
  createdAt: string
  source: { supplierName: string; deliveryNoteNumber: string; reportId: string; reportCode: string } | null
}

/** All OPEN inventory alerts, newest first, enriched with their source delivery where relevant. */
export async function loadOpenAlerts(): Promise<AlertView[]> {
  const alerts = await prisma.inventoryAlert.findMany({
    where: { status: 'OPEN' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, type: true, quantity: true, sourceRecordId: true, createdAt: true,
      project: { select: { name: true } },
      material: { select: { name: true } },
    },
  })

  const deliveryIds = alerts.filter((a) => a.type === 'MISSING_ATTACHMENT' && a.sourceRecordId).map((a) => a.sourceRecordId!)
  const deliveries = deliveryIds.length
    ? await prisma.delivery.findMany({
        where: { id: { in: deliveryIds } },
        select: { id: true, supplierName: true, deliveryNoteNumber: true, dailyReport: { select: { id: true, reportCode: true } } },
      })
    : []
  const byId = new Map(deliveries.map((d) => [d.id, d]))

  return alerts.map((a) => {
    const d = a.sourceRecordId ? byId.get(a.sourceRecordId) : undefined
    return {
      id: a.id,
      type: a.type,
      projectName: a.project.name,
      materialName: a.material?.name ?? null,
      quantity: a.quantity == null ? null : Number(a.quantity),
      createdAt: a.createdAt.toISOString(),
      source: d ? { supplierName: d.supplierName, deliveryNoteNumber: d.deliveryNoteNumber, reportId: d.dailyReport.id, reportCode: d.dailyReport.reportCode } : null,
    }
  })
}
