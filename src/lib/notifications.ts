import { prisma } from '@/lib/prisma'
import { sendReportSubmittedEmail, sendReportReviewedEmail } from '@/lib/email'

/**
 * Report notification emails. Each function corresponds to exactly one lifecycle event
 * and sends at most ONE email (submission → a single email to all active admins;
 * approve/reject → a single email to the author). The routes call these once per
 * successful state transition, and the transition guards prevent an event firing twice
 * for the same report, so notifications are digest-safe (≤1 email per report per event).
 *
 * These are invoked fire-and-forget from the routes and swallow their own errors, so a
 * mail failure never breaks the underlying operation.
 */

function reportContext(report: {
  id: string
  reportCode: string
  reportDate: Date
  project: { name: string }
  author: { firstName: string; lastName: string }
}) {
  return {
    reportId: report.id,
    reportCode: report.reportCode,
    projectName: report.project.name,
    reportDate: report.reportDate.toISOString().slice(0, 10),
    authorName: `${report.author.firstName} ${report.author.lastName}`,
  }
}

export async function notifyReportSubmitted(reportId: string): Promise<void> {
  try {
    const [report, admins] = await Promise.all([
      prisma.dailyReport.findUnique({
        where: { id: reportId },
        select: {
          id: true, reportCode: true, reportDate: true,
          project: { select: { name: true } },
          author: { select: { firstName: true, lastName: true } },
        },
      }),
      prisma.user.findMany({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { email: true } }),
    ])
    if (!report) return
    await sendReportSubmittedEmail(admins.map((a) => a.email), reportContext(report))
  } catch (err) {
    console.error('[notifications] notifyReportSubmitted failed', err)
  }
}

export async function notifyReportReviewed(
  reportId: string,
  decision: 'APPROVED' | 'REJECTED',
  note?: string | null,
): Promise<void> {
  try {
    const report = await prisma.dailyReport.findUnique({
      where: { id: reportId },
      select: {
        id: true, reportCode: true, reportDate: true,
        project: { select: { name: true } },
        author: { select: { firstName: true, lastName: true, email: true, status: true } },
      },
    })
    if (!report || report.author.status !== 'ACTIVE') return
    await sendReportReviewedEmail(report.author.email, {
      ...reportContext(report),
      decision,
      note: note ?? null,
    })
  } catch (err) {
    console.error('[notifications] notifyReportReviewed failed', err)
  }
}
