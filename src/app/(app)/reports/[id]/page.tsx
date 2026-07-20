import { notFound, redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/permissions'
import { prisma } from '@/lib/prisma'
import { getReportScope } from '@/lib/reports/access'
import { canReadReport, canAuthorReport } from '@/lib/reports/query'
import { canEdit, cumulativePercent } from '@/lib/reports/rules'
import { loadFormScope, earnedBySubActivity } from '@/lib/reports/progress'
import { ReportForm } from '@/components/reports/ReportForm'
import { ReportReadOnlyView } from '@/components/reports/ReportReadOnlyView'
import { ReviewActions } from '@/components/reports/ReviewActions'
import type { CategoryOption, MaterialOption } from '@/components/reports/formTypes'

export const dynamic = 'force-dynamic'

const round3 = (n: number) => Math.round(n * 1000) / 1000

export default async function ReportPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const report = await prisma.dailyReport.findUnique({
    where: { id: params.id },
    include: {
      project: { select: { id: true, name: true, projectCode: true } },
      author: { select: { firstName: true, lastName: true } },
      activities: {
        orderBy: { sortOrder: 'asc' },
        include: {
          activity: { select: { name: true, ref: true, unit: true, boqQuantity: true, asset: { select: { name: true } } } },
          subActivities: {
            orderBy: { sortOrder: 'asc' },
            include: {
              subActivity: { select: { name: true, isImplicit: true, type: true, lumpsumBhd: true } },
              manpower: { include: { category: { select: { name: true, isActive: true } } } },
              materials: { include: { material: { select: { name: true, unit: true, isActive: true } } } },
            },
          },
        },
      },
    },
  })
  if (!report) notFound()

  const scope = await getReportScope(user.id, user.role)
  if (!canReadReport(scope, report)) notFound()

  const isAuthor = canAuthorReport(scope, report)
  const editable = isAuthor && canEdit(report.status)
  const reportSubs = report.activities.flatMap((ra) => ra.subActivities)

  if (editable) {
    const [formScope, activeCats, activeMats] = await Promise.all([
      loadFormScope(report.projectId, report.id),
      prisma.laborCategory.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, name: true, isActive: true } }),
      prisma.material.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, name: true, unit: true, isActive: true } }),
    ])

    const catMap = new Map<string, CategoryOption>(activeCats.map((c) => [c.id, c]))
    const matMap = new Map<string, MaterialOption>(activeMats.map((m) => [m.id, m]))
    for (const rs of reportSubs) {
      for (const m of rs.manpower) if (!catMap.has(m.categoryId)) catMap.set(m.categoryId, { id: m.categoryId, name: m.category.name, isActive: m.category.isActive })
      for (const m of rs.materials) if (!matMap.has(m.materialId)) matMap.set(m.materialId, { id: m.materialId, name: m.material.name, unit: m.material.unit, isActive: m.material.isActive })
    }

    return (
      <ReportForm
        report={{
          id: report.id,
          reportCode: report.reportCode,
          reportDate: report.reportDate.toISOString().slice(0, 10),
          status: report.status,
          weather: report.weather,
          generalNotes: report.generalNotes,
          reviewNote: report.reviewNote,
          project: { name: report.project.name, projectCode: report.project.projectCode },
          entries: reportSubs.map((rs) => ({
            subActivityId: rs.subActivityId,
            quantityDone: rs.quantityDone == null ? null : Number(rs.quantityDone),
            percentComplete: rs.percentComplete == null ? null : Number(rs.percentComplete),
            note: rs.note,
            manpower: rs.manpower.map((m) => ({ categoryId: m.categoryId, headcount: m.headcount, hours: Number(m.hours) })),
            materials: rs.materials.map((m) => ({ materialId: m.materialId, quantity: Number(m.quantity) })),
          })),
        }}
        scope={formScope}
        categories={Array.from(catMap.values())}
        materials={Array.from(matMap.values())}
      />
    )
  }

  // Read-only: measured cumulative % per sub from approved earned; lumpsum earned = % × BHD.
  const measuredSubIds = reportSubs.filter((rs) => rs.subActivity.type === 'MEASURED').map((rs) => rs.subActivityId)
  const earned = await earnedBySubActivity(measuredSubIds)
  const canReview = user.role === 'ADMIN' && report.status === 'SUBMITTED'

  return (
    <div className="space-y-4">
      {canReview && <ReviewActions reportId={report.id} />}
      <div className="flex justify-end">
        <a href={`/api/reports/${report.id}/pdf`} target="_blank" rel="noreferrer" className="text-sm font-medium text-primary hover:underline">Download PDF</a>
      </div>
      <ReportReadOnlyView
        canRecall={isAuthor && report.status === 'SUBMITTED'}
        report={{
          id: report.id,
          reportCode: report.reportCode,
          reportDate: report.reportDate.toISOString().slice(0, 10),
          status: report.status,
          weather: report.weather,
          generalNotes: report.generalNotes,
          reviewNote: report.reviewNote,
          project: { name: report.project.name, projectCode: report.project.projectCode },
          author: { name: `${report.author.firstName} ${report.author.lastName}` },
          activities: report.activities.map((ra) => ({
            id: ra.id,
            assetName: ra.activity.asset.name,
            activityRef: ra.activity.ref,
            activityName: ra.activity.name,
            subs: ra.subActivities.map((rs) => {
              const boq = Number(ra.activity.boqQuantity)
              const isLumpsum = rs.subActivity.type === 'LUMPSUM'
              const pct = rs.percentComplete == null ? 0 : Number(rs.percentComplete)
              const lump = rs.subActivity.lumpsumBhd == null ? null : Number(rs.subActivity.lumpsumBhd)
              return {
                id: rs.id,
                name: rs.subActivity.name,
                isImplicit: rs.subActivity.isImplicit,
                type: rs.subActivity.type,
                unit: ra.activity.unit ?? '',
                quantityDone: rs.quantityDone == null ? null : Number(rs.quantityDone),
                percentComplete: rs.percentComplete == null ? null : pct,
                cumulativePercent: isLumpsum ? pct : cumulativePercent(earned.get(rs.subActivityId) ?? 0, boq),
                earnedBhd: isLumpsum && lump != null ? round3((pct / 100) * lump) : null,
                note: rs.note,
                manpower: rs.manpower.map((m) => ({ id: m.id, categoryName: m.category.name, headcount: m.headcount, hours: Number(m.hours) })),
                materials: rs.materials.map((m) => ({ id: m.id, materialName: m.material.name, unit: m.material.unit, quantity: Number(m.quantity) })),
              }
            }),
          })),
        }}
      />
    </div>
  )
}
