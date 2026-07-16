import { type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth/permissions'
import { getReportScope } from '@/lib/reports/access'
import { canReadReport } from '@/lib/reports/query'
import { computeReportTotals, cumulativePercent } from '@/lib/reports/rules'
import { earnedByActivity } from '@/lib/reports/progress'
import { renderReportPdf } from '@/lib/pdf/render'
import { type ReportPdfData } from '@/lib/pdf/ReportPdf'
import { APP_TIMEZONE } from '@/lib/datetime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireUser()
  if ('error' in guard) return guard.error

  const report = await prisma.dailyReport.findUnique({
    where: { id: params.id },
    include: {
      project: { select: { name: true, projectCode: true, location: true } },
      author: { select: { firstName: true, lastName: true } },
      activities: {
        orderBy: { sortOrder: 'asc' },
        include: {
          activity: { select: { name: true, ref: true, unit: true, boqQuantity: true, asset: { select: { name: true } } } },
          manpower: { include: { category: { select: { name: true } } } },
          materials: { include: { material: { select: { name: true, unit: true } } } },
        },
      },
    },
  })
  if (!report) return new Response('Not found', { status: 404 })

  const scope = await getReportScope(guard.user.id, guard.user.role)
  if (!canReadReport(scope, report)) return new Response('Forbidden', { status: 403 })

  const earned = await earnedByActivity(report.activities.map((a) => a.activityId))

  const activities = report.activities.map((ra) => ({
    assetName: ra.activity.asset.name,
    activityName: ra.activity.name,
    ref: ra.activity.ref,
    unit: ra.activity.unit,
    quantityDone: Number(ra.quantityDone),
    cumulativePercent: cumulativePercent(earned.get(ra.activityId) ?? 0, Number(ra.activity.boqQuantity)),
    note: ra.note,
    manpower: ra.manpower.map((m) => ({ categoryName: m.category.name, headcount: m.headcount, hours: Number(m.hours) })),
    materials: ra.materials.map((m) => ({ materialName: m.material.name, unit: m.material.unit, quantity: Number(m.quantity) })),
  }))

  const data: ReportPdfData = {
    reportCode: report.reportCode,
    reportDate: report.reportDate.toISOString().slice(0, 10),
    status: report.status,
    weather: report.weather,
    generalNotes: report.generalNotes,
    project: { name: report.project.name, projectCode: report.project.projectCode, location: report.project.location },
    author: { name: `${report.author.firstName} ${report.author.lastName}` },
    activities,
    totals: computeReportTotals(activities),
    generatedAt: new Date().toLocaleString('en-GB', { timeZone: APP_TIMEZONE }),
  }

  const buffer = await renderReportPdf(data)
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${report.reportCode}.pdf"`,
    },
  })
}
