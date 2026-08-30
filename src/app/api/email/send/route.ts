import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { isNonEmptyString, isValidEmail, normalizeEmail, toIdArray } from '@/lib/validation'
import { isEmailEntityType, resolveSendableDocument } from '@/lib/email/documents.server'
import { sendRecordedEmail, type RecordedRecipient } from '@/lib/email/send.server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Manual document send. ADMIN ONLY — a supervisor never chooses who a company document goes
 * to, and the register of what left the building stays an admin surface.
 *
 * Body: { entityType, entityId, userIds[], addresses[], message? }
 *
 * Recipients are validated in full BEFORE anything is rendered or recorded: one malformed
 * address rejects the whole request rather than being quietly dropped, because a silently
 * shortened recipient list is indistinguishable from a successful send.
 */
export async function POST(req: NextRequest) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const body = await req.json().catch(() => null)

  const entityType = body?.entityType
  if (!isEmailEntityType(entityType)) {
    return NextResponse.json({ error: 'Unknown document type.' }, { status: 400 })
  }
  const entityId = isNonEmptyString(body?.entityId) ? body.entityId.trim() : null
  if (!entityId) return NextResponse.json({ error: 'A document is required.' }, { status: 400 })

  const userIds = toIdArray(body?.userIds ?? [])
  const rawAddresses = toIdArray(body?.addresses ?? [])
  if (userIds === null || rawAddresses === null) {
    return NextResponse.json({ error: 'Recipients must be a list.' }, { status: 400 })
  }
  const message = isNonEmptyString(body?.message) ? body.message.trim() : null

  // Every free-typed address must be valid — reject the request, do not drop the address.
  const external: string[] = []
  for (const raw of rawAddresses) {
    const candidate = raw.trim()
    if (candidate === '') continue
    if (!isValidEmail(candidate)) {
      return NextResponse.json(
        { error: `"${candidate}" is not a valid email address. Nothing was sent.` },
        { status: 400 },
      )
    }
    external.push(normalizeEmail(candidate))
  }

  // App users must all resolve to an active account — an unknown id is a caller bug, not a hint
  // to send to fewer people.
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds }, status: 'ACTIVE' },
        select: { id: true, email: true, firstName: true, lastName: true },
      })
    : []
  if (users.length !== userIds.length) {
    return NextResponse.json(
      { error: 'One or more selected people are no longer active. Nothing was sent.' },
      { status: 400 },
    )
  }

  // De-duplicate by address; an app user beats the same address typed by hand (keeps the userId).
  const byAddress = new Map<string, RecordedRecipient>()
  for (const u of users) byAddress.set(normalizeEmail(u.email), { address: normalizeEmail(u.email), userId: u.id })
  for (const address of external) if (!byAddress.has(address)) byAddress.set(address, { address, userId: null })

  const recipients = Array.from(byAddress.values())
  if (recipients.length === 0) {
    return NextResponse.json({ error: 'Add at least one recipient.' }, { status: 400 })
  }

  const resolved = await resolveSendableDocument(entityType, entityId)
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status })
  const doc = resolved.doc

  const bodyText = message ? `${doc.intro}\n\n${message}` : doc.intro
  const externalIncluded = recipients.some((r) => r.userId == null)

  const result = await sendRecordedEmail({
    subject: doc.subject,
    bodyText,
    recipients,
    attachment: doc.attachment,
    entityType: doc.entityType,
    entityId: doc.entityId,
    entityCode: doc.entityCode,
    projectId: doc.projectId,
    sentById: guard.user.id,
  })

  writeAuditLog({
    action: 'EMAIL_SENT',
    userId: guard.user.id,
    projectId: doc.projectId,
    entity: doc.entityType === 'DAILY_REPORT' ? 'DailyReport' : 'MaterialRequest',
    entityId: doc.entityId,
    entityCode: doc.entityCode,
    metadata: {
      status: result.ok ? 'SENT' : 'FAILED',
      recipientCount: recipients.length,
      externalIncluded,
      attachmentName: doc.attachment.filename,
      emailSendId: result.emailSendId,
      ...(result.ok ? {} : { error: result.error }),
    },
    ipAddress: getClientIp(req),
  })

  if (!result.ok) {
    // Recorded as FAILED; tell the caller plainly that nothing went out.
    return NextResponse.json(
      { error: `The email was not sent: ${result.error}`, emailSendId: result.emailSendId },
      { status: 502 },
    )
  }

  return NextResponse.json({
    ok: true,
    emailSendId: result.emailSendId,
    recipients: result.addresses,
    attachmentName: doc.attachment.filename,
  })
}
