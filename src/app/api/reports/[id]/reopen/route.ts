import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { openingReopenGate, resetOpeningReportSnapshots } from '@/lib/reports/opening.server'

export const dynamic = 'force-dynamic'

/**
 * Re-open an APPROVED opening-balance report back to DRAFT — a NARROW, gated exception to
 * approved-report immutability, for opening balances only (a one-off bulk entry of history an admin
 * may need to correct). ADMIN only. The gate (openingReopenGate) refuses anything that would falsify
 * committed figures; on success the approval/submit snapshots are undone so re-approval re-derives
 * cleanly, then the report is returned fully to DRAFT.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const report = await prisma.dailyReport.findUnique({
    where: { id: params.id },
    select: { id: true, isOpeningBalance: true, status: true, projectId: true, reportCode: true, reportDate: true },
  })
  if (!report) return NextResponse.json({ error: 'Report not found.' }, { status: 404 })

  const gate = await openingReopenGate(report)
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: 409 })

  const priorStatus = report.status
  await prisma.$transaction(async (tx) => {
    // Undo approval/submit snapshots first, then return the report to DRAFT and clear every review
    // field (the recall path only handles a submitted report; here it was approved).
    await resetOpeningReportSnapshots(tx, report.id)
    await tx.dailyReport.update({
      where: { id: report.id },
      data: { status: 'DRAFT', submittedAt: null, reviewedById: null, reviewedAt: null, reviewNote: null },
    })
  })

  writeAuditLog({
    action: 'OPENING_REPORT_REOPENED',
    userId: guard.user.id,
    projectId: report.projectId,
    entity: 'DailyReport',
    entityId: report.id,
    entityCode: report.reportCode,
    metadata: { fromStatus: priorStatus, reopenedAt: new Date().toISOString() },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ ok: true })
}
