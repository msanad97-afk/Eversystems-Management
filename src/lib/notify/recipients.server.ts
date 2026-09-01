import { prisma } from '@/lib/prisma'
import type { NotificationType } from '@prisma/client'
import type { RecordedRecipient } from '@/lib/email/send.server'

/** The GLOBAL distribution list for one notification type, as recorded-send recipients. */
export async function getListRecipients(type: NotificationType): Promise<RecordedRecipient[]> {
  const rows = await prisma.notificationRecipient.findMany({
    where: { type },
    orderBy: { address: 'asc' },
    select: { address: true, userId: true },
  })
  return rows.map((r) => ({ address: r.address, userId: r.userId }))
}

/**
 * A sender-of-record for a SYSTEM-triggered notification (the missing-report cron), which has no
 * acting user. EmailSend.sentById is required, so automated mail is attributed to a stable system
 * account — the earliest active ADMIN, else the earliest active user. Null only when the app has no
 * active users at all, in which case the cron records nothing and sends nothing.
 */
export async function resolveSystemSenderId(): Promise<string | null> {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN', status: 'ACTIVE' }, orderBy: { createdAt: 'asc' }, select: { id: true } })
  if (admin) return admin.id
  const anyUser = await prisma.user.findFirst({ where: { status: 'ACTIVE' }, orderBy: { createdAt: 'asc' }, select: { id: true } })
  return anyUser?.id ?? null
}
