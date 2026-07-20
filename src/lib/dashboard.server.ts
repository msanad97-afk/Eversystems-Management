import { prisma } from '@/lib/prisma'
import {
  aggregateDashboard,
  aggregateProgress,
  COUNTED_STATUSES,
  type DashReport,
  type DashboardResult,
  type ProgressRow,
  type ProjectProgress,
} from '@/lib/dashboard'
import {
  todayCivilString,
  weekStartSaturday,
  civilMidnightUtc,
  addDays,
  diffInDays,
} from '@/lib/datetime'

export const MAX_RANGE_DAYS = 92

function validCivil(v: string | null | undefined): string | null {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())
    ? v
    : null
}

// Phase R: manpower/materials now hang off each activity; the dashboard flattens them
// back to report level so the aggregation in dashboard.ts (and its tests) is unchanged.
type Row = {
  projectId: string
  reportDate: Date
  status: DashReport['status']
  activities: {
    subActivities: {
      manpower: { headcount: number; hours: unknown; category: { name: string } }[]
      materials: { quantity: unknown; material: { name: string; unit: string } }[]
    }[]
  }[]
}
function toDashReport(r: Row): DashReport {
  const subs = r.activities.flatMap((a) => a.subActivities)
  return {
    projectId: r.projectId,
    reportDate: r.reportDate.toISOString().slice(0, 10),
    status: r.status,
    manpower: subs.flatMap((s) =>
      s.manpower.map((m) => ({ categoryName: m.category.name, headcount: m.headcount, hours: Number(m.hours) })),
    ),
    materials: subs.flatMap((s) =>
      s.materials.map((m) => ({ materialName: m.material.name, unit: m.material.unit, quantity: Number(m.quantity) })),
    ),
  }
}

const reportSelect = {
  projectId: true,
  reportDate: true,
  status: true,
  activities: {
    select: {
      subActivities: {
        select: {
          manpower: { select: { headcount: true, hours: true, category: { select: { name: true } } } },
          materials: { select: { quantity: true, material: { select: { name: true, unit: true } } } },
        },
      },
    },
  },
} as const

export interface DashboardResponse extends DashboardResult {
  range: { from: string; to: string }
  progress: ProjectProgress[]
}

/** Fetches raw rows (index-friendly: status + reportDate range + optional projectId) and aggregates. */
export async function loadDashboard(input: {
  projectId?: string
  from?: string | null
  to?: string | null
}): Promise<DashboardResponse> {
  const projectId = input.projectId || undefined
  const today = todayCivilString()

  let from = validCivil(input.from) ?? weekStartSaturday()
  let to = validCivil(input.to) ?? today
  if (from > to) [from, to] = [to, from]
  if (diffInDays(civilMidnightUtc(to), civilMidnightUtc(from)) > MAX_RANGE_DAYS) {
    from = addDays(civilMidnightUtc(to), -MAX_RANGE_DAYS).toISOString().slice(0, 10)
  }
  const yesterday = addDays(civilMidnightUtc(today), -1).toISOString().slice(0, 10)
  const projectWhere = projectId ? { projectId } : {}

  const [rangeRows, todayRows, activeProjects, yesterdayRows] = await Promise.all([
    prisma.dailyReport.findMany({
      where: { status: { in: COUNTED_STATUSES }, reportDate: { gte: civilMidnightUtc(from), lte: civilMidnightUtc(to) }, ...projectWhere },
      select: reportSelect,
    }),
    prisma.dailyReport.findMany({
      where: { status: { in: COUNTED_STATUSES }, reportDate: civilMidnightUtc(today), ...projectWhere },
      select: reportSelect,
    }),
    prisma.project.findMany({
      where: { status: 'ACTIVE', ...(projectId ? { id: projectId } : {}) },
      orderBy: { projectCode: 'asc' },
      select: { id: true, projectCode: true, name: true },
    }),
    prisma.dailyReport.findMany({
      where: { status: { in: COUNTED_STATUSES }, reportDate: civilMidnightUtc(yesterday), ...projectWhere },
      select: { projectId: true },
      distinct: ['projectId'],
    }),
  ])

  const result = aggregateDashboard({
    reports: rangeRows.map(toDashReport),
    from,
    to,
    activeProjects,
    todayReports: todayRows.map(toDashReport),
    yesterdayReportedProjectIds: yesterdayRows.map((r) => r.projectId),
  })

  // ─── Physical progress: active assets→activities for the scoped active projects,
  // earned = APPROVED-only quantityDone as of the range end date (`to`). ───
  // Only MEASURED activities have a physical % (LUMPSUM tracks BHD earned value), so lumpsum
  // lines are excluded. An activity's % is the mean of its measured sub-activities' %s; we
  // feed aggregateProgress a physical-earned-equivalent (mean% × BOQ) so its percent and
  // remaining come out right against the real BOQ.
  const assetsForProgress = await prisma.asset.findMany({
    where: { projectId: { in: activeProjects.map((p) => p.id) }, isActive: true, activities: { some: { isActive: true, type: 'MEASURED' } } },
    orderBy: [{ projectId: 'asc' }, { sortOrder: 'asc' }],
    select: {
      id: true, name: true, projectId: true,
      activities: {
        where: { isActive: true, type: 'MEASURED' },
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true, ref: true, name: true, unit: true, boqQuantity: true,
          subActivities: { where: { isActive: true, type: 'MEASURED' }, select: { id: true } },
        },
      },
    },
  })
  const progSubIds = assetsForProgress.flatMap((a) => a.activities.flatMap((x) => x.subActivities.map((s) => s.id)))
  const earnedRows = progSubIds.length
    ? await prisma.reportSubActivity.groupBy({
        by: ['subActivityId'],
        where: {
          subActivityId: { in: progSubIds },
          quantityDone: { not: null },
          reportActivity: { report: { status: 'APPROVED', reportDate: { lte: civilMidnightUtc(to) } } },
        },
        _sum: { quantityDone: true },
      })
    : []
  const earnedBySub = new Map(earnedRows.map((r) => [r.subActivityId, Number(r._sum.quantityDone ?? 0)]))
  const projMeta = new Map(activeProjects.map((p) => [p.id, p]))
  const progressRows: ProgressRow[] = assetsForProgress.flatMap((asset) =>
    asset.activities
      .filter((act) => act.subActivities.length > 0)
      .map((act) => {
        const boq = Number(act.boqQuantity)
        const perSubPct = act.subActivities.map((s) => (boq > 0 ? Math.min(100, ((earnedBySub.get(s.id) ?? 0) / boq) * 100) : 0))
        const meanPct = perSubPct.reduce((a, b) => a + b, 0) / perSubPct.length
        return {
          projectId: asset.projectId,
          projectCode: projMeta.get(asset.projectId)?.projectCode ?? '',
          projectName: projMeta.get(asset.projectId)?.name ?? '',
          assetId: asset.id,
          assetName: asset.name,
          activityId: act.id,
          ref: act.ref,
          name: act.name,
          unit: act.unit ?? '',
          boqQuantity: boq,
          earned: (meanPct / 100) * boq, // physical-earned-equivalent → percent == mean of subs' %
        }
      }),
  )
  const progress = aggregateProgress(progressRows).sort((a, b) => a.projectCode.localeCompare(b.projectCode))

  return { range: { from, to }, ...result, progress }
}
