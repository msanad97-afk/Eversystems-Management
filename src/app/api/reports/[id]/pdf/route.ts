import { type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth/permissions'
import { getReportScope } from '@/lib/reports/access'
import { canReadReport } from '@/lib/reports/query'
import { computeManpowerTotals, cumulativePercent } from '@/lib/reports/rules'
import { earnedBySubActivity } from '@/lib/reports/progress'
import { renderReportPdf } from '@/lib/pdf/render'
import { type ReportPdfData } from '@/lib/pdf/ReportPdf'
import { APP_TIMEZONE } from '@/lib/datetime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const round3 = (n: number) => Math.round(n * 1000) / 1000

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
          subActivities: {
            orderBy: { sortOrder: 'asc' },
            include: {
              subActivity: { select: { name: true, isImplicit: true, type: true, lumpsumBhd: true } },
              manpower: { include: { category: { select: { name: true } } } },
              materials: { include: { material: { select: { name: true, unit: true } } } },
            },
          },
        },
      },
    },
  })
  if (!report) return new Response('Not found', { status: 404 })

  const scope = await getReportScope(guard.user.id, guard.user.role)
  if (!canReadReport(scope, report)) return new Response('Forbidden', { status: 403 })

  const reportSubs = report.activities.flatMap((ra) => ra.subActivities)
  const measuredSubIds = reportSubs.filter((rs) => rs.subActivity.type === 'MEASURED').map((rs) => rs.subActivityId)
  const earned = await earnedBySubActivity(measuredSubIds)

  const activities = report.activities.map((ra) => ({
    assetName: ra.activity.asset.name,
    activityName: ra.activity.name,
    ref: ra.activity.ref,
    subs: ra.subActivities.map((rs) => {
      const boq = Number(ra.activity.boqQuantity)
      const isLumpsum = rs.subActivity.type === 'LUMPSUM'
      const pct = rs.percentComplete == null ? 0 : Number(rs.percentComplete)
      const lump = rs.subActivity.lumpsumBhd == null ? null : Number(rs.subActivity.lumpsumBhd)
      return {
        name: rs.subActivity.name,
        isImplicit: rs.subActivity.isImplicit,
        type: rs.subActivity.type,
        unit: ra.activity.unit ?? '',
        quantityDone: rs.quantityDone == null ? null : Number(rs.quantityDone),
        percentComplete: rs.percentComplete == null ? null : pct,
        cumulativePercent: isLumpsum ? pct : cumulativePercent(earned.get(rs.subActivityId) ?? 0, boq),
        earnedBhd: isLumpsum && lump != null ? round3((pct / 100) * lump) : null,
        note: rs.note,
        manpower: rs.manpower.map((m) => ({ categoryName: m.category.name, headcount: m.headcount, hours: Number(m.hours) })),
        materials: rs.materials.map((m) => ({ materialName: m.material.name, unit: m.material.unit, quantity: Number(m.quantity) })),
      }
    }),
  }))

  const allManpower = reportSubs.flatMap((rs) => rs.manpower.map((m) => ({ headcount: m.headcount, hours: Number(m.hours) })))

  const data: ReportPdfData = {
    reportCode: report.reportCode,
    reportDate: report.reportDate.toISOString().slice(0, 10),
    status: report.status,
    weather: report.weather,
    generalNotes: report.generalNotes,
    project: { name: report.project.name, projectCode: report.project.projectCode, location: report.project.location },
    author: { name: `${report.author.firstName} ${report.author.lastName}` },
    activities,
    totals: computeManpowerTotals(allManpower),
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
