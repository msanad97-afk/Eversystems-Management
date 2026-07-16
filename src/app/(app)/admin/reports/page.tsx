import { requireRolePage } from '@/lib/auth/permissions'
import { prisma } from '@/lib/prisma'
import { getReportScope } from '@/lib/reports/access'
import { buildReportListWhere, type ReportFilters } from '@/lib/reports/query'
import { activityRollupSelect, rollupActivities } from '@/lib/reports/summary'
import { RegisterClient, type RegisterRow } from './RegisterClient'
import type { ReportStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

function parseStatus(v: string | undefined): ReportStatus | null {
  const all: ReportStatus[] = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED']
  return v && (all as string[]).includes(v) ? (v as ReportStatus) : null
}
function parseDateParam(v: string | undefined): Date | null {
  if (!v) return null
  const d = new Date(`${v}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v)

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const user = await requireRolePage('ADMIN', 'VIEWER')
  const scope = await getReportScope(user.id, user.role)

  const raw = {
    projectId: one(searchParams.projectId) ?? '',
    status: one(searchParams.status) ?? '',
    authorId: one(searchParams.authorId) ?? '',
    from: one(searchParams.from) ?? '',
    to: one(searchParams.to) ?? '',
  }
  const filters: ReportFilters = {
    projectId: raw.projectId || null,
    status: parseStatus(raw.status),
    authorId: raw.authorId || null,
    from: parseDateParam(raw.from),
    to: parseDateParam(raw.to),
  }
  const where = buildReportListWhere(scope, filters)

  const [reports, projects, authors] = await Promise.all([
    prisma.dailyReport.findMany({
      where,
      orderBy: [{ reportDate: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true, reportCode: true, reportDate: true, status: true,
        project: { select: { name: true, projectCode: true } },
        author: { select: { firstName: true, lastName: true } },
        activities: activityRollupSelect,
      },
    }),
    scope.role === 'ADMIN'
      ? prisma.project.findMany({ orderBy: { projectCode: 'asc' }, select: { id: true, name: true, projectCode: true } })
      : prisma.project.findMany({ where: { id: { in: scope.memberProjectIds } }, orderBy: { projectCode: 'asc' }, select: { id: true, name: true, projectCode: true } }),
    prisma.user.findMany({
      where: { role: { in: ['SUPERVISOR', 'ADMIN'] } },
      orderBy: { userCode: 'asc' },
      select: { id: true, firstName: true, lastName: true },
    }),
  ])

  const rows: RegisterRow[] = reports.map((r) => ({
    id: r.id,
    reportCode: r.reportCode,
    reportDate: r.reportDate.toISOString().slice(0, 10),
    status: r.status,
    projectName: r.project.name,
    author: `${r.author.firstName} ${r.author.lastName}`,
    ...(() => { const { workers, manHours } = rollupActivities(r.activities); return { workers, manHours } })(),
  }))

  return (
    <RegisterClient
      rows={rows}
      projects={projects}
      authors={authors.map((a) => ({ id: a.id, name: `${a.firstName} ${a.lastName}` }))}
      filters={raw}
    />
  )
}
