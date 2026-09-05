import nodemailer from 'nodemailer'

/**
 * Brevo SMTP transport. If SMTP_USER/PASSWORD/HOST are not configured (local dev), messages
 * are logged to the console instead of sent — so the reset-link and document-send flows are
 * testable without live credentials.
 *
 * Attachments are passed straight through to nodemailer as in-memory buffers. Nothing is
 * ever written to disk: the PDF is rendered to a Buffer and handed here directly.
 */

export interface MailAttachment {
  filename: string
  contentType: string
  content: Buffer
}

export interface SendMailInput {
  to: string
  subject: string
  html: string
  text?: string
  attachments?: MailAttachment[]
}

function getTransport() {
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT ?? 587)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASSWORD

  if (!user || !pass || !host) return null

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  })
}

/**
 * A test must NEVER reach a real mail transport, regardless of what env vars happen to be set.
 * Per-file mocking is discipline, not a guarantee — one unmocked test that hits a mail route with
 * live SMTP creds in the shell sends a real email (this happened 01/09). This is the hard guard:
 * under Vitest (or NODE_ENV=test) `sendMail` logs the message but does not open a connection.
 */
function isUnderTest(): boolean {
  return process.env.VITEST != null || process.env.NODE_ENV === 'test'
}

export async function sendMail({ to, subject, html, text, attachments }: SendMailInput): Promise<void> {
  const from = process.env.SMTP_FROM ?? 'Eversystems Management <no-reply@eversystems.local>'
  // Refuse to send under test even when SMTP_HOST/USER/PASSWORD are configured; fall through to the
  // same log path as the no-credentials case so a test can still see what would have gone out.
  const transport = isUnderTest() ? null : getTransport()

  if (!transport) {
    const reason = isUnderTest() ? 'running under test' : 'SMTP not configured'
    const files = attachments?.length
      ? `\n  attachments: ${attachments.map((a) => `${a.filename} (${a.content.length} bytes)`).join(', ')}`
      : ''
    console.info(
      `\n[email:dev] ${reason} — message not sent.\n  to: ${to}\n  subject: ${subject}${files}\n  ${text ?? html}\n`,
    )
    return
  }

  await transport.sendMail({ from, to, subject, html, text, attachments })
}
