import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { canReview } from '@/lib/reports/rules'
import { isNonEmptyString } from '@/lib/validation'
import { notifyReportRejected } from '@/lib/notify/events.server'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const body = await req.json().catch(() => null)
  const note = isNonEmptyString(body?.note) ? body.note.trim() : null
  if (!note) {
    return NextResponse.json({ error: 'A rejection note is required.' }, { status: 400 })
  }

  const report = await prisma.dailyReport.findUnique({
    where: { id: params.id },
    select: { id: true, status: true, projectId: true, reportCode: true, authorId: true },
  })
  if (!report) return NextResponse.json({ error: 'Report not found.' }, { status: 404 })

  if (!canReview(report.status)) {
    return NextResponse.json(
      { error: 'Only submitted reports can be rejected.' },
      { status: 409 },
    )
  }

  await prisma.dailyReport.update({
    where: { id: report.id },
    data: {
      status: 'REJECTED',
      reviewedById: guard.user.id,
      reviewedAt: new Date(),
      reviewNote: note,
    },
  })

  writeAuditLog({
    action: 'REPORT_REJECTED',
    userId: guard.user.id,
    projectId: report.projectId,
    entity: 'DailyReport',
    entityId: report.id,
    entityCode: report.reportCode,
    metadata: { note },
    ipAddress: getClientIp(req),
  })

  // Notify the author with the rejection note, via the recorded-send path. Awaited but never
  // throws — the rejection stands whether or not the email lands.
  await notifyReportRejected(report.id, note, guard.user.id)

  return NextResponse.json({ ok: true })
}
