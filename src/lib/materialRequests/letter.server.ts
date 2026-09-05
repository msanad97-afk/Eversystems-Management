import { prisma } from '@/lib/prisma'
import { APP_TIMEZONE } from '@/lib/datetime'
import type { MaterialRequestPdfData } from '@/lib/pdf/MaterialRequestPdf'

/**
 * Loads a REVIEWED material request as letter data — QUANTITIES ONLY. The select never touches
 * Material.unitRate or any cost field, so no price can reach the printed document (the money
 * wall holds even here: the supervisor prints and handles this letter). Only APPROVED /
 * PARTIALLY_APPROVED requests are printable; rejected lines (approvedQty 0) are omitted.
 * Returns `requestedById` so the caller can enforce author-or-admin access.
 */
export async function loadMaterialRequestLetter(
  id: string,
): Promise<{ data: MaterialRequestPdfData; requestedById: string } | null> {
  const request = await prisma.materialRequest.findUnique({
    where: { id },
    select: {
      requestCode: true,
      status: true,
      reviewNote: true,
      reviewedAt: true,
      requestedById: true,
      project: { select: { name: true } },
      asset: { select: { name: true } },
      activity: { select: { name: true, ref: true } },
      requestedBy: { select: { firstName: true, lastName: true } },
      reviewedBy: { select: { firstName: true, lastName: true } },
      lines: {
        orderBy: { sortOrder: 'asc' },
        select: { unit: true, approvedQty: true, material: { select: { name: true } } },
      },
    },
  })
  if (!request) return null
  if (request.status !== 'APPROVED' && request.status !== 'PARTIALLY_APPROVED') return null

  const fmtDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: APP_TIMEZONE })
  // The review timestamp carries date AND time (electronic-approval statement on the letter).
  const fmtDateTime = (d: Date) => d.toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: APP_TIMEZONE })

  const data: MaterialRequestPdfData = {
    requestCode: request.requestCode,
    statusLabel: request.status === 'APPROVED' ? 'Approved' : 'Partially Approved',
    scope: {
      project: request.project.name,
      asset: request.asset?.name ?? null,
      activity: request.activity ? `${request.activity.ref ? `${request.activity.ref} · ` : ''}${request.activity.name}` : null,
    },
    requestedBy: `${request.requestedBy.firstName} ${request.requestedBy.lastName}`,
    reviewedBy: request.reviewedBy ? `${request.reviewedBy.firstName} ${request.reviewedBy.lastName}` : null,
    reviewedAt: request.reviewedAt ? fmtDateTime(request.reviewedAt) : null,
    reviewNote: request.reviewNote,
    // Approved quantities only; drop rejected (0) lines — procurement acts on what to bring.
    lines: request.lines
      .filter((l) => l.approvedQty != null && Number(l.approvedQty) > 0)
      .map((l) => ({ materialName: l.material.name, approvedQty: Number(l.approvedQty), unit: l.unit })),
    generatedAt: fmtDate(new Date()),
  }
  return { data, requestedById: request.requestedById }
}
