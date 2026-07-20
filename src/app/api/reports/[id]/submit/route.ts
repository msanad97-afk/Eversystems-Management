import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { getReportScope } from '@/lib/reports/access'
import { canAuthorReport } from '@/lib/reports/query'
import { canSubmit, validateForSubmit, type SubActivityInput } from '@/lib/reports/rules'
import { remainingBySubActivity, lumpsumFloorBySubActivity } from '@/lib/reports/progress'
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
          subActivities: {
            select: {
              subActivityId: true,
              quantityDone: true,
              percentComplete: true,
              subActivity: { select: { name: true, type: true, activity: { select: { unit: true } } } },
              manpower: { select: { categoryId: true, headcount: true, hours: true } },
              materials: { select: { materialId: true, quantity: true } },
            },
          },
        },
      },
    },
  })
  if (!report) return NextResponse.json({ error: 'Report not found.' }, { status: 404 })

  const scope = await getReportScope(guard.user.id, guard.user.role)
  if (!canAuthorReport(scope, report)) return NextResponse.json({ error: 'You can only submit your own reports.' }, { status: 403 })
  if (!canSubmit(report.status)) return NextResponse.json({ error: 'This report cannot be submitted.' }, { status: 403 })

  const rows = report.activities.flatMap((a) => a.subActivities)
  const subIds = rows.map((r) => r.subActivityId)
  const lumpsumIds = rows.filter((r) => r.subActivity.type === 'LUMPSUM').map((r) => r.subActivityId)
  const [remaining, floors] = await Promise.all([
    remainingBySubActivity(subIds, report.id),
    lumpsumFloorBySubActivity(lumpsumIds),
  ])

  const subs: SubActivityInput[] = rows.map((r) => ({
    subActivityId: r.subActivityId,
    label: r.subActivity.name,
    type: r.subActivity.type as 'MEASURED' | 'LUMPSUM',
    unit: r.subActivity.activity.unit ?? undefined,
    quantityDone: r.quantityDone == null ? 0 : Number(r.quantityDone),
    remaining: remaining.get(r.subActivityId)?.remaining ?? 0,
    percentComplete: r.percentComplete == null ? 0 : Number(r.percentComplete),
    lastApprovedPercent: floors.get(r.subActivityId) ?? 0,
    manpower: r.manpower.map((m) => ({ categoryId: m.categoryId, headcount: m.headcount, hours: Number(m.hours) })),
    materials: r.materials.map((m) => ({ materialId: m.materialId, quantity: Number(m.quantity) })),
  }))

  const error = validateForSubmit(subs)
  if (error) return NextResponse.json({ error }, { status: 400 })

  await prisma.dailyReport.update({
    where: { id: report.id },
    data: { status: 'SUBMITTED', submittedAt: new Date(), reviewedById: null, reviewedAt: null, reviewNote: null },
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
