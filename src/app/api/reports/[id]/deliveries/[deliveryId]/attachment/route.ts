import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { getReportScope } from '@/lib/reports/access'
import { canReadReport } from '@/lib/reports/query'
import { uploadDeliveryAttachment, signedAttachmentUrl, ALLOWED_ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES } from '@/lib/deliveries/blob.server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const deliverySelect = {
  id: true,
  dailyReportId: true,
  attachmentUrl: true,
  dailyReport: { select: { id: true, authorId: true, projectId: true, status: true, reportCode: true } },
} as const

/**
 * Upload (or replace) a delivery-note attachment.
 *
 * DELIBERATE EXCEPTION TO REPORT IMMUTABILITY: this is allowed at ANY report status, including
 * APPROVED. An attachment supplies evidence for an existing delivery record — it does not alter
 * the record's quantities or scope — so the usual `canEdit` gate does NOT apply here. Do not
 * "fix" this by adding a status check; that would break attaching notes to approved reports.
 * Permission is instead: the report author OR an admin.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string; deliveryId: string } }) {
  const guard = await requireUser()
  if ('error' in guard) return guard.error

  const delivery = await prisma.delivery.findUnique({ where: { id: params.deliveryId }, select: deliverySelect })
  if (!delivery || delivery.dailyReportId !== params.id) {
    return NextResponse.json({ error: 'Delivery not found.' }, { status: 404 })
  }
  const report = delivery.dailyReport

  const isAuthor = report.authorId === guard.user.id
  const isAdmin = guard.user.role === 'ADMIN'
  if (!isAuthor && !isAdmin) {
    return NextResponse.json({ error: 'Only the report author or an admin can attach a delivery note.' }, { status: 403 })
  }

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided.' }, { status: 400 })
  if (!(ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(file.type)) {
    return NextResponse.json({ error: 'Unsupported file type. Upload a JPEG, PNG, WebP, or PDF.' }, { status: 400 })
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json({ error: 'File is too large. The maximum attachment size is 10 MB.' }, { status: 400 })
  }

  // Upload to the private store BEFORE the DB write (external call can't live in a transaction).
  const bytes = Buffer.from(await file.arrayBuffer())
  const pathname = await uploadDeliveryAttachment(delivery.id, bytes, file.type)

  // Atomically: store the attachment + auto-resolve any OPEN MISSING_ATTACHMENT alert for it.
  await prisma.$transaction(async (tx) => {
    await tx.delivery.update({ where: { id: delivery.id }, data: { attachmentUrl: pathname } })
    await tx.inventoryAlert.updateMany({
      where: { type: 'MISSING_ATTACHMENT', sourceRecordId: delivery.id, status: 'OPEN' },
      data: { status: 'ACKNOWLEDGED', acknowledgedById: guard.user.id, acknowledgedAt: new Date() },
    })
  })

  writeAuditLog({
    action: 'DELIVERY_ATTACHMENT_UPLOADED',
    userId: guard.user.id,
    projectId: report.projectId,
    entity: 'Delivery',
    entityId: delivery.id,
    entityCode: report.reportCode,
    metadata: { replaced: delivery.attachmentUrl != null, contentType: file.type },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ ok: true, hasAttachment: true })
}

/**
 * Return a short-lived signed URL for the delivery's attachment. Permission reuses the existing
 * report-read rule (author, reviewers/admins, or project members) — anyone who can view the
 * report can view its notes. The raw blob URL is never stored in or emitted by a serializer.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string; deliveryId: string } }) {
  const guard = await requireUser()
  if ('error' in guard) return guard.error

  const delivery = await prisma.delivery.findUnique({ where: { id: params.deliveryId }, select: deliverySelect })
  if (!delivery || delivery.dailyReportId !== params.id) {
    return NextResponse.json({ error: 'Delivery not found.' }, { status: 404 })
  }

  const scope = await getReportScope(guard.user.id, guard.user.role)
  if (!canReadReport(scope, { authorId: delivery.dailyReport.authorId, projectId: delivery.dailyReport.projectId })) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  }
  if (!delivery.attachmentUrl) return NextResponse.json({ error: 'No attachment on this delivery.' }, { status: 404 })

  const url = await signedAttachmentUrl(delivery.attachmentUrl)
  return NextResponse.json({ url })
}
