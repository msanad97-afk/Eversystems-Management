import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { getReportScope } from '@/lib/reports/access'
import { canAuthorReport } from '@/lib/reports/query'
import { canRecall } from '@/lib/reports/rules'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireUser()
  if ('error' in guard) return guard.error

  const report = await prisma.dailyReport.findUnique({
    where: { id: params.id },
    select: { id: true, authorId: true, projectId: true, status: true, reportCode: true },
  })
  if (!report) return NextResponse.json({ error: 'Report not found.' }, { status: 404 })

  const scope = await getReportScope(guard.user.id, guard.user.role)
  if (!canAuthorReport(scope, report)) {
    return NextResponse.json({ error: 'You can only recall your own reports.' }, { status: 403 })
  }
  if (!canRecall(report.status)) {
    return NextResponse.json({ error: 'Only submitted reports can be recalled.' }, { status: 403 })
  }

  await prisma.dailyReport.update({
    where: { id: report.id },
    data: { status: 'DRAFT', submittedAt: null },
  })

  writeAuditLog({
    action: 'REPORT_RECALLED',
    userId: guard.user.id,
    projectId: report.projectId,
    entity: 'DailyReport',
    entityId: report.id,
    entityCode: report.reportCode,
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ ok: true })
}
