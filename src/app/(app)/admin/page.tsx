import { requireAdminPage } from '@/lib/auth/permissions'
import { prisma } from '@/lib/prisma'
import { loadDashboard } from '@/lib/dashboard.server'
import { KpiCard } from '@/components/admin/KpiCard'
import { ManpowerChart } from '@/components/admin/ManpowerChart'
import { MaterialsTotalsTable } from '@/components/admin/MaterialsTotalsTable'
import { MissingReportsAlert } from '@/components/admin/MissingReportsAlert'
import { DashboardFilters } from '@/components/admin/DashboardFilters'
import { ProgressPanel } from '@/components/admin/ProgressPanel'

export const dynamic = 'force-dynamic'

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v)

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  })
}

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  await requireAdminPage()

  const projectId = one(searchParams.projectId) ?? ''
  const [data, projects] = await Promise.all([
    loadDashboard({ projectId: projectId || undefined, from: one(searchParams.from), to: one(searchParams.to) }),
    prisma.project.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { projectCode: 'asc' },
      select: { id: true, name: true, projectCode: true },
    }),
  ])

  const { kpis, manHoursPerDay, materialTotals, missingYesterday, range, progress } = data
  const coveragePct =
    kpis.reportsExpected > 0 ? Math.round((kpis.reportsSubmitted / kpis.reportsExpected) * 100) : 0

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-fg">Dashboard</h1>
        <p className="text-sm text-fg-subtle">
          {fmtDate(range.from)} – {fmtDate(range.to)}
        </p>
      </div>

      <DashboardFilters projects={projects} filters={{ projectId, from: range.from, to: range.to }} />

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          label="Reports submitted"
          value={`${kpis.reportsSubmitted} / ${kpis.reportsExpected}`}
          sub={`${coveragePct}% of project-days covered`}
        />
        <KpiCard label="Total man-hours" value={kpis.totalManHours.toLocaleString()} sub="Submitted + approved" />
        <KpiCard label="Active workers today" value={kpis.activeWorkersToday.toLocaleString()} />
      </div>

      {/* Missing-report alert */}
      <MissingReportsAlert missing={missingYesterday} />

      {/* Physical progress by asset/activity */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">
          Physical progress{projectId ? '' : ' by project'}
        </h2>
        <ProgressPanel progress={progress} selectedProjectId={projectId} />
      </section>

      {/* Man-hours per day */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Man-hours per day</h2>
        <ManpowerChart rows={manHoursPerDay.rows} max={manHoursPerDay.max} />
      </section>

      {/* Materials totals */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Material consumption</h2>
        <MaterialsTotalsTable materials={materialTotals} />
      </section>
    </div>
  )
}
