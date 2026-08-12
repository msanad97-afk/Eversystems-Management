import type { Prisma } from '@prisma/client'

/**
 * On report submit: raise ONE MISSING_ATTACHMENT alert per delivery that has no attachment.
 * Idempotent by `sourceRecordId` (the Delivery id) — resubmitting a report never duplicates an
 * alert, and a delivery that already has an OPEN/ACKNOWLEDGED alert is left alone. Runs inside
 * the submit transaction. Returns how many alerts were created.
 */
export async function syncMissingAttachmentAlerts(
  tx: Prisma.TransactionClient,
  reportId: string,
  projectId: string,
): Promise<number> {
  const deliveries = await tx.delivery.findMany({
    where: { dailyReportId: reportId },
    select: { id: true, attachmentUrl: true },
  })
  const missing = deliveries.filter((d) => d.attachmentUrl == null)
  if (missing.length === 0) return 0

  const existing = await tx.inventoryAlert.findMany({
    where: { type: 'MISSING_ATTACHMENT', sourceRecordId: { in: missing.map((d) => d.id) } },
    select: { sourceRecordId: true },
  })
  const have = new Set(existing.map((e) => e.sourceRecordId))
  const toCreate = missing.filter((d) => !have.has(d.id))
  if (toCreate.length === 0) return 0

  await tx.inventoryAlert.createMany({
    data: toCreate.map((d) => ({ projectId, type: 'MISSING_ATTACHMENT' as const, sourceRecordId: d.id, status: 'OPEN' as const })),
  })
  return toCreate.length
}
