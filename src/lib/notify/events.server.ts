import { prisma } from '@/lib/prisma'
import { writeAuditLog, recordAuditLog } from '@/lib/audit'
import { sendRecordedEmail, type RecordedRecipient } from '@/lib/email/send.server'
import { resolveSendableDocument } from '@/lib/email/documents.server'
import type { MailAttachment } from '@/lib/email/transport'
import type { MaterialRequestStatus } from '@prisma/client'
import { getListRecipients } from '@/lib/notify/recipients.server'

/**
 * Phase B-2 event notifications. Every one goes through the SAME recorded-send path
 * (sendRecordedEmail), so it lands in the EmailSend register alongside manual sends. Each function
 * is AWAITED by its caller but NEVER throws — it catches and records every failure — so a mail
 * outage can never break the action (reject / review / certify / the cron) that triggered it.
 */

const bhd = (n: unknown) => `BHD ${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`

// ─── 1. REPORT REJECTED → the report's author (derived) ───────────────────────
export async function notifyReportRejected(reportId: string, note: string, sentById: string): Promise<void> {
  try {
    const report = await prisma.dailyReport.findUnique({
      where: { id: reportId },
      select: {
        id: true, reportCode: true, reportDate: true, projectId: true,
        project: { select: { name: true } },
        author: { select: { id: true, email: true, status: true } },
      },
    })
    if (!report || report.author.status !== 'ACTIVE') return
    const date = report.reportDate.toISOString().slice(0, 10)
    const subject = `Report ${report.reportCode} returned — ${report.project.name}`
    // The review note is the actionable part; carry it verbatim.
    const bodyText = [
      `Your daily report ${report.reportCode} for ${report.project.name} (${date}) was returned for changes.`,
      `Reason:\n${note}`,
      `Please edit the report and resubmit.`,
    ].join('\n\n')
    await sendRecordedEmail({
      subject, bodyText,
      recipients: [{ address: report.author.email, userId: report.author.id }],
      attachment: null,
      entityType: 'DAILY_REPORT', entityId: report.id, entityCode: report.reportCode,
      projectId: report.projectId, sentById,
    })
  } catch (err) {
    console.error('[notify] notifyReportRejected failed', err)
  }
}

// ─── 2. MATERIAL REQUEST REVIEWED → accounts (approved) or the requester (rejected/fallback) ──
// Phase C-2 WIDENS the single B-2 notification rather than adding a second one: an APPROVED or
// PARTIALLY_APPROVED request becomes an order to the ACCOUNTS list, cc the requesting supervisor and
// the MATERIAL_REQUEST_MANAGEMENT list. A fully REJECTED request is unchanged — requester only. So
// the supervisor still receives exactly ONE email in every case.
export async function notifyMaterialRequestReviewed(requestId: string, status: MaterialRequestStatus, note: string | null, sentById: string): Promise<void> {
  try {
    const request = await prisma.materialRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true, requestCode: true, projectId: true,
        project: { select: { name: true } },
        requestedBy: { select: { id: true, email: true, status: true } },
      },
    })
    if (!request || request.requestedBy.status !== 'ACTIVE') return

    const decision = status === 'APPROVED' ? 'approved' : status === 'PARTIALLY_APPROVED' ? 'partially approved' : 'rejected'
    const supervisor = request.requestedBy

    // The procurement letter exists only when quantities were approved. The Phase A resolver returns
    // a non-ok result (no letter) for a fully-rejected request — that must NOT stop the notification.
    let attachment: MailAttachment | null = null
    if (status !== 'REJECTED') {
      const resolved = await resolveSendableDocument('MATERIAL_REQUEST', request.id)
      if (resolved.ok) attachment = resolved.doc.attachment
    }

    // The Phase B-2 requester notification — used for a rejection, and as the fallback when there is
    // no ACCOUNTS list to route the order to.
    const notifyRequester = () =>
      sendRecordedEmail({
        subject: `Material request ${request.requestCode} ${decision} — ${request.project.name}`,
        bodyText: [
          `Your material request ${request.requestCode} for ${request.project.name} has been ${decision}.`,
          note ? `Reviewer note:\n${note}` : null,
          attachment ? `The approved procurement letter is attached.` : `No quantities were approved, so there is no procurement letter.`,
        ].filter(Boolean).join('\n\n'),
        recipients: [{ address: supervisor.email, userId: supervisor.id }],
        attachment,
        entityType: 'MATERIAL_REQUEST', entityId: request.id, entityCode: request.requestCode,
        projectId: request.projectId, sentById,
      })

    // A fully-rejected request has nothing to order — unchanged from B-2, requester only.
    if (status === 'REJECTED') {
      await notifyRequester()
      return
    }

    // APPROVED / PARTIALLY_APPROVED → an order for ACCOUNTS to place, copying supervisor + management.
    const accounts = await getListRecipients('ACCOUNTS')
    if (accounts.length === 0) {
      // No accounts list configured: fall back to notifying the requester (as today) and record WHY,
      // so an approval is never silently left un-ordered.
      await recordAuditLog({
        action: 'NOTIFICATION_SENT', userId: sentById, projectId: request.projectId,
        entity: 'MaterialRequest', entityId: request.id, entityCode: request.requestCode,
        metadata: { type: 'ACCOUNTS', recipientCount: 0, skipped: 'empty accounts list', fallback: 'requester' },
      })
      await notifyRequester()
      return
    }

    // TO: accounts. CC: the requesting supervisor + management — de-duped by address, and never an
    // address already on TO (a person is copied at most once; TO wins over CC).
    const toByAddr = new Map<string, RecordedRecipient>()
    for (const a of accounts) toByAddr.set(a.address.toLowerCase(), { address: a.address, userId: a.userId, role: 'TO' })
    const ccByAddr = new Map<string, RecordedRecipient>()
    ccByAddr.set(supervisor.email.toLowerCase(), { address: supervisor.email, userId: supervisor.id, role: 'CC' })
    const management = await getListRecipients('MATERIAL_REQUEST_MANAGEMENT')
    for (const m of management) if (!ccByAddr.has(m.address.toLowerCase())) ccByAddr.set(m.address.toLowerCase(), { address: m.address, userId: m.userId, role: 'CC' })
    for (const addr of toByAddr.keys()) ccByAddr.delete(addr)
    const recipients: RecordedRecipient[] = [...toByAddr.values(), ...ccByAddr.values()]

    await sendRecordedEmail({
      subject: `Purchase authorisation — ${request.requestCode} (${request.project.name}) — order approved materials`,
      bodyText: [
        `Material request ${request.requestCode} for ${request.project.name} has been ${decision} and is cleared for ordering.`,
        `Please place the order for the approved quantities in the attached procurement letter.`,
        note ? `Reviewer note:\n${note}` : null,
        `The requesting site supervisor and management are copied.`,
      ].filter(Boolean).join('\n\n'),
      recipients,
      attachment,
      entityType: 'MATERIAL_REQUEST', entityId: request.id, entityCode: request.requestCode,
      projectId: request.projectId, sentById,
    })
  } catch (err) {
    console.error('[notify] notifyMaterialRequestReviewed failed', err)
  }
}

// ─── 3. VALUATION CERTIFIED → the VALUATION_CERTIFIED list (no attachment) ────
export async function notifyValuationCertified(valuationId: string, sentById: string): Promise<void> {
  try {
    // Sequential (not Promise.all): a rejected sibling in Promise.all would surface as an unhandled
    // rejection even though the outer try/catch handles the awaited one.
    const valuation = await prisma.valuation.findUnique({
      where: { id: valuationId },
      select: { id: true, valuationCode: true, periodMonth: true, projectId: true, grossAmount: true, netPayable: true, project: { select: { name: true } } },
    })
    if (!valuation) return
    const recipients = await getListRecipients('VALUATION_CERTIFIED')

    if (recipients.length === 0) {
      // Empty list: send nothing, but record WHY in the audit rather than failing.
      writeAuditLog({
        action: 'NOTIFICATION_SENT', userId: sentById, projectId: valuation.projectId,
        entity: 'Valuation', entityId: valuation.id, entityCode: valuation.valuationCode,
        metadata: { type: 'VALUATION_CERTIFIED', recipientCount: 0, skipped: 'empty list' },
      })
      return
    }

    const period = valuation.periodMonth.toISOString().slice(0, 7)
    const bodyText = [
      `Interim payment certificate ${valuation.valuationCode} for ${valuation.project.name} (period ${period}) has been certified.`,
      `Gross to date: ${bhd(valuation.grossAmount)}\nNet payable this period: ${bhd(valuation.netPayable)}`,
    ].join('\n\n')

    await sendRecordedEmail({
      subject: `Certificate ${valuation.valuationCode} certified — ${valuation.project.name}`,
      bodyText,
      recipients,
      attachment: null, // no certified-valuation PDF renderer exists (Phase B-2 decision)
      entityType: 'VALUATION', entityId: valuation.id, entityCode: valuation.valuationCode,
      projectId: valuation.projectId, sentById,
    })
  } catch (err) {
    console.error('[notify] notifyValuationCertified failed', err)
  }
}

// ─── 4. NO REPORT FILED → REPORT_MISSING list + the project's supervisors ─────
export type MissingReportOutcome = 'sent' | 'skipped-duplicate' | 'no-recipients' | 'failed'

export async function notifyMissingReport(
  project: { id: string; projectCode: string; name: string },
  dateStr: string,
  sentById: string,
): Promise<MissingReportOutcome> {
  try {
    const entityId = `${project.id}:${dateStr}`
    // Idempotent per project per date: any prior REPORT_MISSING send for this key (even a failed
    // attempt, which still recorded a row) means the cron already ran — do not send again.
    const already = await prisma.emailSend.findFirst({ where: { entityType: 'REPORT_MISSING', entityId }, select: { id: true } })
    if (already) return 'skipped-duplicate'

    const listRecipients = await getListRecipients('REPORT_MISSING')
    const supervisors = await prisma.user.findMany({
      where: { status: 'ACTIVE', role: 'SUPERVISOR', projects: { some: { projectId: project.id } } },
      select: { id: true, email: true },
    })
    // De-dupe by address; an app user (supervisor) wins over a free-typed list address.
    const byAddress = new Map<string, RecordedRecipient>()
    for (const s of supervisors) byAddress.set(s.email.toLowerCase(), { address: s.email, userId: s.id })
    for (const r of listRecipients) if (!byAddress.has(r.address.toLowerCase())) byAddress.set(r.address.toLowerCase(), r)
    const recipients = [...byAddress.values()]
    if (recipients.length === 0) return 'no-recipients'

    const res = await sendRecordedEmail({
      subject: `No report filed — ${project.name} (${dateStr})`,
      bodyText: `No daily report has been filed for ${project.name} (${project.projectCode}) for ${dateStr}. Please ensure the site files today's report.`,
      recipients,
      attachment: null,
      entityType: 'REPORT_MISSING', entityId, entityCode: project.projectCode,
      projectId: project.id, sentById,
    })
    return res.ok ? 'sent' : 'failed'
  } catch (err) {
    console.error('[notify] notifyMissingReport failed', err)
    return 'failed'
  }
}
