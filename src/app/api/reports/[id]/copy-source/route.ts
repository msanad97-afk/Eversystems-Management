import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth/permissions'
import { getReportScope } from '@/lib/reports/access'
import { canAuthorReport } from '@/lib/reports/query'

/**
 * "Copy yesterday": the author's most recent prior report on this project, as the crew
 * (manpower/materials) they logged per sub-activity. Progress numbers (quantityDone /
 * percentComplete) are intentionally omitted — the supervisor enters today's progress.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireUser()
  if ('error' in guard) return guard.error

  const report = await prisma.dailyReport.findUnique({
    where: { id: params.id },
    select: { id: true, authorId: true, projectId: true, reportDate: true, status: true },
  })
  if (!report) return NextResponse.json({ error: 'Report not found.' }, { status: 404 })

  const scope = await getReportScope(guard.user.id, guard.user.role)
  if (!canAuthorReport(scope, report)) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })

  const prior = await prisma.dailyReport.findFirst({
    where: {
      projectId: report.projectId,
      authorId: report.authorId,
      id: { not: report.id },
      reportDate: { lt: report.reportDate },
    },
    orderBy: [{ reportDate: 'desc' }, { createdAt: 'desc' }],
    select: {
      reportDate: true,
      activities: {
        select: {
          subActivities: {
            select: {
              subActivityId: true,
              subActivity: { select: { isActive: true } },
              manpower: { select: { categoryId: true, headcount: true, hours: true } },
              materials: { select: { materialId: true, quantity: true } },
            },
          },
        },
      },
    },
  })

  if (!prior) return NextResponse.json({ source: null })

  const subActivities = prior.activities
    .flatMap((a) => a.subActivities)
    .filter((rs) => rs.subActivity.isActive && (rs.manpower.length > 0 || rs.materials.length > 0))
    .map((rs) => ({
      subActivityId: rs.subActivityId,
      manpower: rs.manpower.map((m) => ({ categoryId: m.categoryId, headcount: m.headcount, hours: Number(m.hours) })),
      materials: rs.materials.map((m) => ({ materialId: m.materialId, quantity: Number(m.quantity) })),
    }))

  return NextResponse.json({ source: { date: prior.reportDate.toISOString().slice(0, 10), subActivities } })
}
