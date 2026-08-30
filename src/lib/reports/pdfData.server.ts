import { prisma } from '@/lib/prisma'
import { computeManpowerTotals, cumulativePercent } from '@/lib/reports/rules'
import { earnedBySubActivity } from '@/lib/reports/progress'
import { type ReportPdfData } from '@/lib/pdf/ReportPdf'
import { APP_TIMEZONE } from '@/lib/datetime'
import type { ReportStatus } from '@prisma/client'

/**
 * Builds the daily-report PDF payload. Extracted from the PDF route so the email sender
 * renders the SAME document from the SAME code path — there is exactly one definition of
 * what a report PDF contains.
 *
 * QUANTITIES ONLY on the shared surfaces: the only money that reaches the document is the
 * lumpsum earned value the existing PDF already renders. No unit rate, no actual cost, no
 * material price is selected here.
 *
 * Returns the identifying fields alongside the payload so the caller can run its own access
 * (route) or sendable-state (email) check without a second query.
 */

const round3 = (n: number) => Math.round(n * 1000) / 1000

export interface ReportPdfBundle {
  data: ReportPdfData
  reportId: string
  reportCode: string
  projectId: string
  authorId: string
  status: ReportStatus
  projectName: string
  reportDate: string
}

export async function loadReportPdfData(id: string): Promise<ReportPdfBundle | null> {
  const report = await prisma.dailyReport.findUnique({
    where: { id },
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
  if (!report) return null

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
  const reportDate = report.reportDate.toISOString().slice(0, 10)

  const data: ReportPdfData = {
    reportCode: report.reportCode,
    reportDate,
    status: report.status,
    weather: report.weather,
    generalNotes: report.generalNotes,
    project: { name: report.project.name, projectCode: report.project.projectCode, location: report.project.location },
    author: { name: `${report.author.firstName} ${report.author.lastName}` },
    activities,
    totals: computeManpowerTotals(allManpower),
    generatedAt: new Date().toLocaleString('en-GB', { timeZone: APP_TIMEZONE }),
  }

  return {
    data,
    reportId: report.id,
    reportCode: report.reportCode,
    projectId: report.projectId,
    authorId: report.authorId,
    status: report.status,
    projectName: report.project.name,
    reportDate,
  }
}
