import nodemailer from 'nodemailer'

/**
 * Brevo SMTP mailer. If SMTP_USER is not configured (local dev), messages are
 * logged to the console instead of sent — so the reset-link flow is testable
 * without live credentials.
 */

interface SendMailInput {
  to: string
  subject: string
  html: string
  text?: string
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

export async function sendMail({ to, subject, html, text }: SendMailInput): Promise<void> {
  const from = process.env.SMTP_FROM ?? 'Eversystems Management <no-reply@eversystems.local>'
  const transport = getTransport()

  if (!transport) {
    console.info(
      `\n[email:dev] SMTP not configured — message not sent.\n  to: ${to}\n  subject: ${subject}\n  ${text ?? html}\n`,
    )
    return
  }

  await transport.sendMail({ from, to, subject, html, text })
}

function appUrl(path: string): string {
  const base = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
  return `${base.replace(/\/$/, '')}${path}`
}

function shell(bodyHtml: string): string {
  return `<div style="font-family: Inter, Arial, sans-serif; color: #1A1917; line-height: 1.5;">${bodyHtml}</div>`
}
function button(href: string, label: string): string {
  return `<p><a href="${href}" style="display:inline-block;background:#C42217;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;">${label}</a></p>`
}

export interface ReportEmailContext {
  reportId: string
  reportCode: string
  projectName: string
  reportDate: string
  authorName: string
}

/** Sent to admins when a supervisor submits a report (one email per submission event). */
export async function sendReportSubmittedEmail(
  to: string[],
  ctx: ReportEmailContext,
): Promise<void> {
  if (to.length === 0) return
  const link = appUrl(`/reports/${ctx.reportId}`)
  const html = shell(`
    <p>A daily report has been submitted for review.</p>
    <p><strong>${ctx.projectName}</strong> — ${ctx.reportDate}<br>
    ${ctx.reportCode} · by ${ctx.authorName}</p>
    ${button(link, 'Review report')}
  `)
  await sendMail({
    to: to.join(', '),
    subject: `Report submitted — ${ctx.projectName} (${ctx.reportDate})`,
    html,
    text: `${ctx.authorName} submitted ${ctx.reportCode} for ${ctx.projectName} on ${ctx.reportDate}. Review: ${link}`,
  })
}

/** Sent to the author when their report is approved or rejected (one email per decision). */
export async function sendReportReviewedEmail(
  to: string,
  ctx: ReportEmailContext & { decision: 'APPROVED' | 'REJECTED'; note?: string | null },
): Promise<void> {
  const link = appUrl(`/reports/${ctx.reportId}`)
  const approved = ctx.decision === 'APPROVED'
  const html = shell(`
    <p>Your daily report for <strong>${ctx.projectName}</strong> (${ctx.reportDate}) was
    <strong>${approved ? 'approved' : 'returned for changes'}</strong>.</p>
    <p>${ctx.reportCode}</p>
    ${!approved && ctx.note ? `<p style="background:#FCEBEA;border:1px solid #C42217;padding:10px;border-radius:8px;"><strong>Note:</strong> ${ctx.note}</p>` : ''}
    ${button(link, approved ? 'View report' : 'Fix & resubmit')}
  `)
  await sendMail({
    to,
    subject: approved
      ? `Report approved — ${ctx.projectName} (${ctx.reportDate})`
      : `Report returned — ${ctx.projectName} (${ctx.reportDate})`,
    html,
    text: approved
      ? `Your report ${ctx.reportCode} for ${ctx.projectName} (${ctx.reportDate}) was approved. ${link}`
      : `Your report ${ctx.reportCode} for ${ctx.projectName} (${ctx.reportDate}) was returned.${ctx.note ? ` Note: ${ctx.note}` : ''} ${link}`,
  })
}

export async function sendPasswordResetEmail(params: {
  to: string
  firstName: string
  token: string
}): Promise<void> {
  const link = appUrl(`/reset-password?token=${encodeURIComponent(params.token)}`)
  const html = `
    <div style="font-family: Inter, Arial, sans-serif; color: #1A1917; line-height: 1.5;">
      <p>Hello ${params.firstName},</p>
      <p>A password reset was requested for your Eversystems Management account.</p>
      <p><a href="${link}" style="display:inline-block;background:#C42217;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;">Set a new password</a></p>
      <p style="color:#5A5852;font-size:13px;">Or paste this link into your browser:<br>${link}</p>
      <p style="color:#5A5852;font-size:13px;">This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>
    </div>
  `
  await sendMail({
    to: params.to,
    subject: 'Reset your Eversystems Management password',
    html,
    text: `Reset your password: ${link} (expires in 1 hour)`,
  })
}
