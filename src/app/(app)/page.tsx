import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/permissions'
import { prisma } from '@/lib/prisma'
import { SupervisorHome } from './SupervisorHome'
import { ReportCard, type ReportListItem } from '@/components/reports/ReportCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { startOfAppDay, todayCivilString, addDays } from '@/lib/datetime'
import { activityRollupSelect, rollupActivities } from '@/lib/reports/summary'

export const dynamic = 'force-dynamic'

function appToday(): { str: string; date: Date; fourteenAgo: Date } {
  const date = startOfAppDay()
  return { str: todayCivilString(), date, fourteenAgo: addDays(date, -14) }
}

function summarize(r: {
  id: string
  reportCode: string
  reportDate: Date
  status: ReportListItem['status']
  project: { id: string; projectCode: string; name: string }
  activities: { manpower: { headcount: number; hours: unknown }[]; materials: { id: string }[] }[]
}): ReportListItem {
  return {
    id: r.id,
    reportCode: r.reportCode,
    reportDate: r.reportDate.toISOString().slice(0, 10),
    status: r.status,
    project: r.project,
    ...rollupActivities(r.activities),
  }
}

export default async function HomePage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  // Admins land on the ops dashboard (Phase 4). Phase 9 moves the ADMIN landing to
  // the executive /manager home; /admin stays the ops dashboard.
  if (user.role === 'ADMIN') redirect('/admin')

  const { str: todayStr, date: today, fourteenAgo } = appToday()

  const memberships = await prisma.projectMember.findMany({
    where: { userId: user.id, project: { status: 'ACTIVE' } },
    select: { project: { select: { id: true, name: true, projectCode: true } } },
  })
  const projects = memberships.map((m) => m.project)
  const projectIds = projects.map((p) => p.id)

  if (user.role === 'VIEWER') {
    const recent = await prisma.dailyReport.findMany({
      where: { projectId: { in: projectIds }, reportDate: { gte: fourteenAgo } },
      orderBy: [{ reportDate: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true, reportCode: true, reportDate: true, status: true,
        project: { select: { id: true, projectCode: true, name: true } },
        activities: activityRollupSelect,
      },
    })
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-fg">Recent reports</h1>
        {recent.length === 0 ? (
          <EmptyState title="No reports yet" description="Reports on your projects will appear here." />
        ) : (
          <div className="space-y-2">
            {recent.map((r) => (
              <ReportCard key={r.id} report={summarize(r)} />
            ))}
          </div>
        )}
      </div>
    )
  }

  // SUPERVISOR
  const [todayReports, recent] = await Promise.all([
    prisma.dailyReport.findMany({
      where: { authorId: user.id, reportDate: today, projectId: { in: projectIds } },
      select: { id: true, projectId: true, status: true, updatedAt: true },
    }),
    prisma.dailyReport.findMany({
      where: { authorId: user.id, reportDate: { gte: fourteenAgo } },
      orderBy: [{ reportDate: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true, reportCode: true, reportDate: true, status: true,
        project: { select: { id: true, projectCode: true, name: true } },
        activities: activityRollupSelect,
      },
    }),
  ])

  const todayByProject = new Map(todayReports.map((r) => [r.projectId, r]))

  // Projects with at least one active activity are reportable; others show a "scope not set up" note.
  const scopedAssets = await prisma.asset.findMany({
    where: { projectId: { in: projectIds }, isActive: true, activities: { some: { isActive: true } } },
    select: { projectId: true },
    distinct: ['projectId'],
  })
  const reportable = new Set(scopedAssets.map((a) => a.projectId))

  return (
    <SupervisorHome
      firstName={user.firstName}
      todayStr={todayStr}
      projects={projects.map((p) => {
        const t = todayByProject.get(p.id)
        return {
          id: p.id,
          name: p.name,
          projectCode: p.projectCode,
          reportable: reportable.has(p.id),
          today: t ? { id: t.id, status: t.status, updatedAt: t.updatedAt.toISOString() } : null,
        }
      })}
      recent={recent.map(summarize)}
    />
  )
}
