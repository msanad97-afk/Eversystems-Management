import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { canReview } from '@/lib/reports/rules'
import { notifyReportReviewed } from '@/lib/notifications'
import { snapshotReportCosts } from '@/lib/reports/costSnapshot'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const report = await prisma.dailyReport.findUnique({
    where: { id: params.id },
    select: { id: true, status: true, projectId: true, reportCode: true, authorId: true },
  })
  if (!report) return NextResponse.json({ error: 'Report not found.' }, { status: 404 })

  if (!canReview(report.status)) {
    return NextResponse.json(
      { error: 'Only submitted reports can be approved.' },
      { status: 409 },
    )
  }

  // Approval is the write-once point for the Actual-Cost snapshot: lock the status and
  // cost every entry at the live rate in the SAME transaction, so an approved report can
  // never exist without its costs having been attempted.
  const costs = await prisma.$transaction(async (tx) => {
    await tx.dailyReport.update({
      where: { id: report.id },
      data: {
        status: 'APPROVED',
        reviewedById: guard.user.id,
        reviewedAt: new Date(),
        reviewNote: null,
      },
    })
    return snapshotReportCosts(tx, report.id)
  })

  writeAuditLog({
    action: 'REPORT_APPROVED',
    userId: guard.user.id,
    projectId: report.projectId,
    entity: 'DailyReport',
    entityId: report.id,
    entityCode: report.reportCode,
    metadata: {
      costSnapshot: costs.totalCost,
      unpricedManpower: costs.unpricedManpower,
      unpricedMaterial: costs.unpricedMaterial,
    },
    ipAddress: getClientIp(req),
  })

  // Notify the author (fire-and-forget).
  void notifyReportReviewed(report.id, 'APPROVED')

  return NextResponse.json({ ok: true })
}
