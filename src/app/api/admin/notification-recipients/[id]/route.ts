import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'

/** Remove one address from a notification list (ADMIN only). */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const recipient = await prisma.notificationRecipient.findUnique({ where: { id: params.id }, select: { id: true, type: true, address: true } })
  if (!recipient) return NextResponse.json({ error: 'Recipient not found.' }, { status: 404 })

  await prisma.$transaction((tx) => tx.notificationRecipient.delete({ where: { id: recipient.id } }))

  writeAuditLog({
    action: 'NOTIFICATION_RECIPIENT_REMOVED', userId: guard.user.id,
    entity: 'NotificationRecipient', entityId: recipient.id,
    metadata: { type: recipient.type, address: recipient.address },
    ipAddress: getClientIp(req),
  })
  return NextResponse.json({ ok: true, id: recipient.id })
}
