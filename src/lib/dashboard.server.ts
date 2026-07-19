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
    manpower: { headcount: number; hours: unknown; category: { name: string } }[]
    materials: { quantity: unknown; material: { name: string; unit: string } }[]
  }[]
}
function toDashReport(r: Row): DashReport {
  return {
    projectId: r.projectId,
    reportDate: r.reportDate.toISOString().slice(0, 10),
    status: r.status,
    manpower: r.activities.flatMap((a) =>
      a.manpower.map((m) => ({ categoryName: m.category.name, headcount: m.headcount, hours: Number(m.hours) })),
    ),
    materials: r.activities.flatMap((a) =>
      a.materials.map((m) => ({ materialName: m.material.name, unit: m.material.unit, quantity: Number(m.quantity) })),
    ),
  }
}

const reportSelect = {
  projectId: true,
  reportDate: true,
  status: true,
  activities: {
    select: {
      manpower: { select: { headcount: true, hours: true, category: { select: { name: true } } } },
      materials: { select: { quantity: true, material: { select: { name: true, unit: true } } } },
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
  const assetsForProgress = await prisma.asset.findMany({
    where: { projectId: { in: activeProjects.map((p) => p.id) }, isActive: true, activities: { some: { isActive: true } } },
    orderBy: [{ projectId: 'asc' }, { sortOrder: 'asc' }],
    select: {
      id: true, name: true, projectId: true,
      activities: { where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, ref: true, name: true, unit: true, boqQuantity: true } },
    },
  })
  const progActivityIds = assetsForProgress.flatMap((a) => a.activities.map((x) => x.id))
  const earnedRows = progActivityIds.length
    ? await prisma.reportActivity.groupBy({
        by: ['activityId'],
        where: { activityId: { in: progActivityIds }, report: { status: 'APPROVED', reportDate: { lte: civilMidnightUtc(to) } } },
        _sum: { quantityDone: true },
      })
    : []
  const earnedMap = new Map(earnedRows.map((r) => [r.activityId, Number(r._sum.quantityDone ?? 0)]))
  const projMeta = new Map(activeProjects.map((p) => [p.id, p]))
  const progressRows: ProgressRow[] = assetsForProgress.flatMap((asset) =>
    asset.activities.map((act) => ({
      projectId: asset.projectId,
      projectCode: projMeta.get(asset.projectId)?.projectCode ?? '',
      projectName: projMeta.get(asset.projectId)?.name ?? '',
      assetId: asset.id,
      assetName: asset.name,
      activityId: act.id,
      ref: act.ref,
      name: act.name,
      unit: act.unit,
      boqQuantity: Number(act.boqQuantity),
      earned: earnedMap.get(act.id) ?? 0,
    })),
  )
  const progress = aggregateProgress(progressRows).sort((a, b) => a.projectCode.localeCompare(b.projectCode))

  return { range: { from, to }, ...result, progress }
}
