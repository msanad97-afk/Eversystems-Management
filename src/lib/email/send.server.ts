import { prisma } from '@/lib/prisma'
import { sendMail, type MailAttachment } from '@/lib/email/transport'

/**
 * Recorded send — the one place any outbound document email goes through.
 *
 * Phase A uses it for the manual send; the event-triggered notifications (Phase B) and the
 * weekly summary (Phase C) are meant to reuse it unchanged, which is why it knows nothing
 * about routes, sessions or entity types beyond the frozen labels it is handed.
 *
 * Order matters: the EmailSend row is written PENDING *before* the transport is touched, so a
 * process that dies mid-send still leaves evidence of the attempt. The row then settles to
 * SENT or FAILED. A transport failure is RECORDED and RETURNED, never thrown — the caller's
 * route must not 500 because Brevo was down.
 *
 * Email bodies carry the document as an attachment and nothing else: no blob URL, no signed
 * URL, no storage link ever goes into a message that can be forwarded outside the company.
 */

export type EmailEntityType = 'DAILY_REPORT' | 'MATERIAL_REQUEST'

export interface RecordedRecipient {
  address: string
  /** Set when the recipient was picked from the app's user list; null for a free-typed address. */
  userId?: string | null
}

export interface RecordedEmailInput {
  subject: string
  bodyText: string
  recipients: RecordedRecipient[]
  attachment?: MailAttachment | null
  entityType: EmailEntityType
  entityId: string
  /** Frozen at send time — survives a later rename of the entity. */
  entityCode: string
  projectId?: string | null
  sentById: string
}

export type RecordedEmailResult =
  | { ok: true; emailSendId: string; addresses: string[] }
  | { ok: false; emailSendId: string | null; error: string }

function escapeHtml(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Plain-text body → the same minimal shell the other app emails use. */
export function bodyToHtml(bodyText: string, attachmentName?: string | null): string {
  const paragraphs = bodyText
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('')
  const note = attachmentName
    ? `<p style="color:#5A5852;font-size:13px;">Attached: ${escapeHtml(attachmentName)}</p>`
    : ''
  return `<div style="font-family: Inter, Arial, sans-serif; color: #1A1917; line-height: 1.5;">${paragraphs}${note}</div>`
}

export async function sendRecordedEmail(input: RecordedEmailInput): Promise<RecordedEmailResult> {
  const addresses = input.recipients.map((r) => r.address)

  // PENDING row + its frozen recipients, atomically, before anything is sent.
  let emailSendId: string
  try {
    const row = await prisma.$transaction(async (tx) => {
      return tx.emailSend.create({
        data: {
          subject: input.subject,
          bodyText: input.bodyText,
          entityType: input.entityType,
          entityId: input.entityId,
          entityCode: input.entityCode,
          projectId: input.projectId ?? null,
          attachmentName: input.attachment?.filename ?? null,
          status: 'PENDING',
          sentById: input.sentById,
          recipients: {
            create: input.recipients.map((r) => ({ address: r.address, userId: r.userId ?? null })),
          },
        },
        select: { id: true },
      })
    })
    emailSendId = row.id
  } catch (err) {
    // Could not even record the attempt — report it rather than sending an untracked email.
    console.error('[email] failed to record EmailSend', err)
    return { ok: false, emailSendId: null, error: 'Could not record the send. Nothing was sent.' }
  }

  try {
    await sendMail({
      to: addresses.join(', '),
      subject: input.subject,
      html: bodyToHtml(input.bodyText, input.attachment?.filename),
      text: input.bodyText,
      attachments: input.attachment ? [input.attachment] : undefined,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The mail transport rejected the message.'
    // Settling the row must not mask the original failure; swallow a secondary write error.
    await prisma.emailSend
      .update({ where: { id: emailSendId }, data: { status: 'FAILED', errorMessage: message } })
      .catch((e) => console.error('[email] failed to mark EmailSend FAILED', e))
    return { ok: false, emailSendId, error: message }
  }

  await prisma.emailSend
    .update({ where: { id: emailSendId }, data: { status: 'SENT', sentAt: new Date() } })
    .catch((e) => console.error('[email] failed to mark EmailSend SENT', e))

  return { ok: true, emailSendId, addresses }
}
