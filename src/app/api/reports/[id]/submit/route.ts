import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { getReportScope } from '@/lib/reports/access'
import { canAuthorReport } from '@/lib/reports/query'
import { canSubmit, validateForSubmit, type ActivityInput } from '@/lib/reports/rules'
import { remainingByActivity } from '@/lib/reports/progress'
import { notifyReportSubmitted } from '@/lib/notifications'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireUser()
  if ('error' in guard) return guard.error

  const report = await prisma.dailyReport.findUnique({
    where: { id: params.id },
    select: {
      id: true, authorId: true, projectId: true, status: true, reportCode: true,
      activities: {
        select: {
          activityId: true,
          quantityDone: true,
          activity: { select: { name: true, unit: true } },
          manpower: { select: { categoryId: true, headcount: true, hours: true } },
          materials: { select: { materialId: true, quantity: true } },
        },
      },
    },
  })
  if (!report) return NextResponse.json({ error: 'Report not found.' }, { status: 404 })

  const scope = await getReportScope(guard.user.id, guard.user.role)
  if (!canAuthorReport(scope, report)) {
    return NextResponse.json({ error: 'You can only submit your own reports.' }, { status: 403 })
  }
  if (!canSubmit(report.status)) {
    return NextResponse.json({ error: 'This report cannot be submitted.' }, { status: 403 })
  }

  const activityIds = report.activities.map((a) => a.activityId)
  const remaining = await remainingByActivity(activityIds, report.id)
  const activities: ActivityInput[] = report.activities.map((a) => ({
    activityId: a.activityId,
    activityName: a.activity.name,
    unit: a.activity.unit,
    quantityDone: Number(a.quantityDone),
    remaining: remaining.get(a.activityId)?.remaining ?? 0,
    manpower: a.manpower.map((m) => ({ categoryId: m.categoryId, headcount: m.headcount, hours: Number(m.hours) })),
    materials: a.materials.map((m) => ({ materialId: m.materialId, quantity: Number(m.quantity) })),
  }))

  const error = validateForSubmit(activities)
  if (error) return NextResponse.json({ error }, { status: 400 })

  await prisma.dailyReport.update({
    where: { id: report.id },
    data: {
      status: 'SUBMITTED',
      submittedAt: new Date(),
      reviewedById: null,
      reviewedAt: null,
      reviewNote: null,
    },
  })

  writeAuditLog({
    action: 'REPORT_SUBMITTED',
    userId: guard.user.id,
    projectId: report.projectId,
    entity: 'DailyReport',
    entityId: report.id,
    entityCode: report.reportCode,
    ipAddress: getClientIp(req),
  })

  void notifyReportSubmitted(report.id)

  return NextResponse.json({ ok: true })
}
