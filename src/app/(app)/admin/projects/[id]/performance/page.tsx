import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireAdminPage } from '@/lib/auth/permissions'
import { loadProjectEvm, loadActivityEvm } from '@/lib/evm.server'
import { EvmKpiRow, EvmDataQuality, AssetEvmTable, ActivityEvmTable, ProjectEconomicsPanel } from '@/components/admin/EvmPanels'
import { SCurveChart } from '@/components/admin/SCurveChart'
import { BaselineEditor } from '@/components/admin/BaselineEditor'
import { EmptyState } from '@/components/ui/EmptyState'

export const dynamic = 'force-dynamic'

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v)

/** Performance (EVM) — ADMIN-only; `requireAdminPage` redirects everyone else. */
export default async function PerformancePage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: Record<string, string | string[] | undefined>
}) {
  await requireAdminPage()

  const project = await prisma.project.findUnique({
    where: { id: params.id },
    select: { id: true, projectCode: true, name: true },
  })
  if (!project) notFound()

  const asOfParam = one(searchParams.asOf)
  const asOf = asOfParam && /^\d{4}-\d{2}-\d{2}$/.test(asOfParam) ? new Date(`${asOfParam}T00:00:00.000Z`) : undefined
  const assetId = one(searchParams.assetId)

  const [evm, baselineRows, drill] = await Promise.all([
    loadProjectEvm(project.id, asOf),
    prisma.baselinePeriod.findMany({
      where: { projectId: project.id },
      orderBy: { periodMonth: 'asc' },
      select: { periodMonth: true, cumPlannedPct: true },
    }),
    assetId ? loadActivityEvm(project.id, assetId, asOf) : Promise.resolve(null),
  ])
  if (!evm) notFound()

  const baseline = baselineRows.map((r) => ({
    periodMonth: r.periodMonth.toISOString().slice(0, 10),
    cumPlannedPct: Number(r.cumPlannedPct),
  }))

  return (
    <div className="space-y-5">
      <div>
        <Link href={`/admin/projects/${project.id}`} className="text-sm font-medium text-primary hover:underline">
          ← {project.name}
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-fg">Performance</h1>
        <p className="mono text-sm text-fg-subtle">{project.projectCode} · as of {evm.asOf}</p>
      </div>

      {evm.bac === 0 ? (
        <EmptyState
          title="No budgeted scope yet"
          description="Earned value needs placed activities with cost rates. Add scope and price it, then approve field reports."
        />
      ) : (
        <>
          <EvmDataQuality evm={evm} />
          <EvmKpiRow evm={evm} />

          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Planned vs earned vs actual</h2>
            <SCurveChart series={evm.series} asOf={evm.asOf} hasBaseline={evm.hasBaseline} />
          </section>

          <AssetEvmTable assets={evm.assets} projectId={project.id} />

          {drill && (
            <section className="space-y-2">
              <ActivityEvmTable assetName={drill.assetName} activities={drill.activities} />
              <Link href={`/admin/projects/${project.id}/performance`} className="text-xs font-medium text-primary hover:underline">
                ← Back to all assets
              </Link>
            </section>
          )}

          <ProjectEconomicsPanel evm={evm} />
        </>
      )}

      <BaselineEditor projectId={project.id} initial={baseline} />
    </div>
  )
}
