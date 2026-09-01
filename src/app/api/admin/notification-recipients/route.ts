import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { isNonEmptyString, isValidEmail, normalizeEmail } from '@/lib/validation'
import { NOTIFICATION_TYPES, isNotificationType } from '@/lib/notify/types'

/**
 * Add an address to a GLOBAL notification list (ADMIN only). Either `userId` (an app user, whose
 * current email is frozen onto the row) or a typed `address` (validated). A malformed address is
 * rejected, never silently dropped.
 */
export async function POST(req: NextRequest) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const body = await req.json().catch(() => null)
  const type = body?.type
  if (!isNotificationType(type)) {
    return NextResponse.json({ error: `type must be one of ${NOTIFICATION_TYPES.join(', ')}.` }, { status: 400 })
  }

  let address: string
  let userId: string | null = null
  if (isNonEmptyString(body?.userId)) {
    const user = await prisma.user.findUnique({ where: { id: body.userId }, select: { id: true, email: true, status: true } })
    if (!user || user.status !== 'ACTIVE') return NextResponse.json({ error: 'Unknown or inactive user.' }, { status: 400 })
    address = normalizeEmail(user.email)
    userId = user.id
  } else if (isNonEmptyString(body?.address)) {
    const candidate = normalizeEmail(body.address)
    if (!isValidEmail(candidate)) return NextResponse.json({ error: 'That is not a valid email address.' }, { status: 400 })
    address = candidate
  } else {
    return NextResponse.json({ error: 'Pick an app user or type an email address.' }, { status: 400 })
  }

  const existing = await prisma.notificationRecipient.findUnique({ where: { type_address: { type, address } }, select: { id: true } })
  if (existing) return NextResponse.json({ error: 'That address is already on this list.' }, { status: 409 })

  const created = await prisma.$transaction((tx) =>
    tx.notificationRecipient.create({ data: { type, address, userId }, select: { id: true, type: true, address: true, userId: true } }),
  )

  writeAuditLog({
    action: 'NOTIFICATION_RECIPIENT_ADDED', userId: guard.user.id,
    entity: 'NotificationRecipient', entityId: created.id,
    metadata: { type, address, fromUser: userId != null },
    ipAddress: getClientIp(req),
  })
  return NextResponse.json({ recipient: created }, { status: 201 })
}
