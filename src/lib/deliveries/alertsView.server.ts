import { prisma } from '@/lib/prisma'

/** Management-facing view of an inventory alert. ADMIN-only surface; no cost fields. */
export interface AlertView {
  id: string
  type: 'MISSING_ATTACHMENT' | 'COUNT_VARIANCE' | 'NEGATIVE_BALANCE' | 'MISSING_CONSUMPTION_RATE'
  projectName: string
  materialName: string | null
  quantity: number | null
  createdAt: string
  /** MISSING_ATTACHMENT: the source delivery. */
  source: { supplierName: string; deliveryNoteNumber: string; reportId: string; reportCode: string } | null
  /** MISSING_CONSUMPTION_RATE: the reported work whose consumption could not be tracked. */
  work: { subActivityName: string; reportId: string; reportCode: string } | null
}

/** All OPEN inventory alerts, newest first, enriched with their source record. */
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

  // Enrich MISSING_ATTACHMENT with its delivery, MISSING_CONSUMPTION_RATE with its work line.
  const deliveryIds = alerts.filter((a) => a.type === 'MISSING_ATTACHMENT' && a.sourceRecordId).map((a) => a.sourceRecordId!)
  const subReportIds = alerts.filter((a) => a.type === 'MISSING_CONSUMPTION_RATE' && a.sourceRecordId).map((a) => a.sourceRecordId!)

  const [deliveries, subReports] = await Promise.all([
    deliveryIds.length
      ? prisma.delivery.findMany({ where: { id: { in: deliveryIds } }, select: { id: true, supplierName: true, deliveryNoteNumber: true, dailyReport: { select: { id: true, reportCode: true } } } })
      : Promise.resolve([]),
    subReportIds.length
      ? prisma.reportSubActivity.findMany({ where: { id: { in: subReportIds } }, select: { id: true, subActivity: { select: { name: true } }, reportActivity: { select: { report: { select: { id: true, reportCode: true } } } } } })
      : Promise.resolve([]),
  ])
  const deliveryById = new Map(deliveries.map((d) => [d.id, d]))
  const subById = new Map(subReports.map((s) => [s.id, s]))

  return alerts.map((a) => {
    const d = a.sourceRecordId ? deliveryById.get(a.sourceRecordId) : undefined
    const s = a.sourceRecordId ? subById.get(a.sourceRecordId) : undefined
    return {
      id: a.id,
      type: a.type,
      projectName: a.project.name,
      materialName: a.material?.name ?? null,
      quantity: a.quantity == null ? null : Number(a.quantity),
      createdAt: a.createdAt.toISOString(),
      source: d ? { supplierName: d.supplierName, deliveryNoteNumber: d.deliveryNoteNumber, reportId: d.dailyReport.id, reportCode: d.dailyReport.reportCode } : null,
      work: s ? { subActivityName: s.subActivity.name, reportId: s.reportActivity.report.id, reportCode: s.reportActivity.report.reportCode } : null,
    }
  })
}
