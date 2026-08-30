import { prisma } from '@/lib/prisma'
import { APP_TIMEZONE } from '@/lib/datetime'
import type { EmailEntityType } from '@/lib/email/send.server'
import type { EmailSendStatus } from '@prisma/client'

/**
 * Send history for one entity — "who sent this, to whom, when". Reads the FROZEN recipient
 * addresses off EmailRecipient rather than re-resolving users, so the history keeps telling
 * the truth after an address change. FAILED attempts are included on purpose: an admin needs
 * to see that a send was tried and did not land.
 */

export interface EmailSendHistoryRow {
  id: string
  status: EmailSendStatus
  errorMessage: string | null
  attachmentName: string | null
  sentByName: string
  recipients: string[]
  /** Formatted in the app timezone; the row is display-only. */
  at: string
}

export async function loadEmailSends(
  entityType: EmailEntityType,
  entityId: string,
): Promise<EmailSendHistoryRow[]> {
  const sends = await prisma.emailSend.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      errorMessage: true,
      attachmentName: true,
      createdAt: true,
      sentAt: true,
      sentBy: { select: { firstName: true, lastName: true } },
      recipients: { select: { address: true } },
    },
  })

  return sends.map((s) => ({
    id: s.id,
    status: s.status,
    errorMessage: s.errorMessage,
    attachmentName: s.attachmentName,
    sentByName: `${s.sentBy.firstName} ${s.sentBy.lastName}`,
    recipients: s.recipients.map((r) => r.address),
    at: (s.sentAt ?? s.createdAt).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      timeZone: APP_TIMEZONE,
    }),
  }))
}

/** Active app users an admin can pick as recipients (name + email, no role/cost detail). */
export async function loadRecipientCandidates(): Promise<{ id: string; name: string; email: string }[]> {
  const users = await prisma.user.findMany({
    where: { status: 'ACTIVE' },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    select: { id: true, firstName: true, lastName: true, email: true },
  })
  return users.map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`, email: u.email }))
}
