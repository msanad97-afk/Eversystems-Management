import { prisma } from '@/lib/prisma'
import { recordAuditLog } from '@/lib/audit'
import { sendRecordedEmail } from '@/lib/email/send.server'
import { getListRecipients } from '@/lib/notify/recipients.server'
import { loadWeeklySummary, weekBoundary } from '@/lib/weeklySummary.server'
import { renderWeeklySummaryPdf } from '@/lib/pdf/render'

/**
 * Phase C delivery of the weekly summary. Goes through the SAME recorded-send path
 * (sendRecordedEmail) as every other document, and NEVER throws — a mail outage cannot break the
 * cron. Idempotent per week (the WEEKLY_SUMMARY EmailSend row for that Sunday blocks a second send).
 * An empty recipient list sends nothing and records WHY in the audit, mirroring notifyValuationCertified.
 */

export type WeeklySummaryOutcome = 'sent' | 'skipped-duplicate' | 'no-recipients' | 'failed'

const bhd = (n: number) => `BHD ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`

export async function deliverWeeklySummary(opts: { sentById: string; instant?: Date }): Promise<{ outcome: WeeklySummaryOutcome; week: string }> {
  const week = weekBoundary(opts.instant)
  const entityId = week.key
  try {
    // Idempotent per week: any prior WEEKLY_SUMMARY send for this Sunday (even a failed attempt, which
    // still recorded a row) means the week already went out — do not send again.
    const already = await prisma.emailSend.findFirst({ where: { entityType: 'WEEKLY_SUMMARY', entityId }, select: { id: true } })
    if (already) return { outcome: 'skipped-duplicate', week: entityId }

    const recipients = await getListRecipients('WEEKLY_SUMMARY')
    if (recipients.length === 0) {
      // Empty list: send nothing, but record WHY in the audit (awaited — the record is the only
      // evidence the run happened) rather than failing.
      await recordAuditLog({
        action: 'NOTIFICATION_SENT', userId: opts.sentById,
        entity: 'Cron', entityId: 'weekly-summary',
        metadata: { type: 'WEEKLY_SUMMARY', week: entityId, recipientCount: 0, skipped: 'empty list' },
      })
      return { outcome: 'no-recipients', week: entityId }
    }

    const data = await loadWeeklySummary({ instant: opts.instant })
    const pdf = await renderWeeklySummaryPdf(data)
    const bodyText = [
      `The weekly management summary for ${data.week.label} is attached.`,
      `Across ${data.portfolio.activeProjectCount} active project(s): total contract value ${bhd(data.portfolio.totalContractValue)}, actual cost to date ${bhd(data.portfolio.totalActualCost)}, outstanding receivables ${bhd(data.portfolio.outstandingReceivables)}.`,
      `Reports filed ${data.portfolio.reportsFiled} of ${data.portfolio.reportsExpected} expected this week.`,
    ].join('\n\n')

    const res = await sendRecordedEmail({
      subject: `Weekly summary — ${data.week.label}`,
      bodyText,
      recipients,
      attachment: { filename: `weekly-summary-${entityId}.pdf`, contentType: 'application/pdf', content: pdf },
      entityType: 'WEEKLY_SUMMARY', entityId, entityCode: `WK-${entityId}`,
      projectId: null, sentById: opts.sentById,
    })
    return { outcome: res.ok ? 'sent' : 'failed', week: entityId }
  } catch (err) {
    console.error('[notify] deliverWeeklySummary failed', err)
    return { outcome: 'failed', week: entityId }
  }
}
