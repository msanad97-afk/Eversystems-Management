import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireAdminPage } from '@/lib/auth/permissions'
import { ScopeManager, type ScopeAssetData, type CatalogOption, type AddSubInfo } from '@/components/admin/ScopeManager'
import { BudgetPanel } from '@/components/admin/BudgetPanel'
import { VariancePanel } from '@/components/admin/VariancePanel'
import { CostBudgetPanel } from '@/components/admin/CostBudgetPanel'
import { ActualCostPanel } from '@/components/admin/ActualCostPanel'
import { ExpensesManager } from '@/components/admin/ExpensesManager'
import { serializeScopeActivity, scopeActivitySelect } from '@/lib/scope'
import { loadProjectBudget } from '@/lib/budget.server'
import { loadBudgetVsActual } from '@/lib/actuals.server'
import { loadProjectMoney } from '@/lib/money.server'
import { loadProjectCostPerformance } from '@/lib/cost.server'

export const dynamic = 'force-dynamic'

const UNIT_SUGGESTIONS = ['m2', 'm3', 'LM', 'm', 'no', 'ton', 'kg', 'lot', 'sum', 'hr', 'day']

export default async function ProjectDetailPage({ params }: { params: { id: string } }) {
  await requireAdminPage()

  const project = await prisma.project.findUnique({
    where: { id: params.id },
    select: { id: true, projectCode: true, name: true, location: true, status: true },
  })
  if (!project) notFound()

  const [assets, catalog, budget, variance, money, costPerf] = await Promise.all([
    prisma.asset.findMany({
      where: { projectId: project.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true, ref: true, name: true, description: true, isActive: true, sortOrder: true,
        activities: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: scopeActivitySelect },
      },
    }),
    prisma.catalogActivity.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, type: true, unit: true, lumpsumBhd: true },
    }),
    loadProjectBudget(project.id),
    loadBudgetVsActual(project.id),
    loadProjectMoney(project.id),
    loadProjectCostPerformance(project.id),
  ])

  const serialized: ScopeAssetData[] = assets.map((a) => ({
    id: a.id, ref: a.ref, name: a.name, description: a.description, isActive: a.isActive, sortOrder: a.sortOrder,
    activities: a.activities.map(serializeScopeActivity),
  }))
  const catalogOptions: CatalogOption[] = catalog.map((c) => ({
    id: c.id, name: c.name, type: c.type, unit: c.unit, lumpsumBhd: c.lumpsumBhd == null ? null : Number(c.lumpsumBhd),
  }))

  // Per-activity add-sub-activity info: which template subs are still addable (missing by name from
  // the placed copy), and whether the activity is a flat implicit-only line (add is disabled then).
  const rawActs = assets.flatMap((a) => a.activities)
  const catalogIds = [...new Set(rawActs.map((x) => x.catalogActivityId).filter((x): x is string => !!x))]
  const [placedSubs, templateSubs] = await Promise.all([
    prisma.subActivity.findMany({ where: { activityId: { in: rawActs.map((x) => x.id) } }, select: { activityId: true, name: true, isActive: true, isImplicit: true } }),
    catalogIds.length
      ? prisma.catalogSubActivity.findMany({ where: { catalogActivityId: { in: catalogIds }, isImplicit: false }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, type: true, catalogActivityId: true } })
      : Promise.resolve([] as { id: string; name: string; type: 'MEASURED' | 'LUMPSUM'; catalogActivityId: string }[]),
  ])
  const addSubInfo: Record<string, AddSubInfo> = {}
  for (const act of rawActs) {
    const subs = placedSubs.filter((s) => s.activityId === act.id)
    const placedNames = new Set(subs.map((s) => s.name.trim().toLowerCase()))
    const activeSubs = subs.filter((s) => s.isActive)
    const implicitOnly = activeSubs.length === 1 && activeSubs[0]!.isImplicit
    const addableCatalogSubs = act.catalogActivityId
      ? templateSubs
          .filter((t) => t.catalogActivityId === act.catalogActivityId && !placedNames.has(t.name.trim().toLowerCase()))
          .map((t) => ({ id: t.id, name: t.name, type: t.type }))
      : []
    addSubInfo[act.id] = { implicitOnly, addableCatalogSubs }
  }

  return (
    <div className="space-y-5">
      <div>
        <Link href="/admin/projects" className="text-sm font-medium text-primary-700 hover:underline">
          ← Projects
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold text-fg">{project.name}</h1>
            <p className="mono text-sm text-fg-subtle">
              {project.projectCode}
              {project.location ? ` · ${project.location}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/admin/projects/${project.id}/valuations`}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-surface-muted"
            >
              Valuations →
            </Link>
            <Link
              href={`/admin/projects/${project.id}/performance`}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-surface-muted"
            >
              Performance (EVM) →
            </Link>
          </div>
        </div>
      </div>

      <ScopeManager
        projectId={project.id}
        assets={serialized}
        unitSuggestions={UNIT_SUGGESTIONS}
        catalogOptions={catalogOptions}
        addSubInfo={addSubInfo}
      />

      {money && <CostBudgetPanel money={money} />}
      {costPerf && <ActualCostPanel cost={costPerf} projectId={project.id} />}
      {costPerf && (
        <ExpensesManager
          projectId={project.id}
          initial={[...costPerf.expenses.eligible, ...costPerf.expenses.excluded].sort((a, b) => b.expenseDate.localeCompare(a.expenseDate))}
        />
      )}
      {variance && <VariancePanel data={variance} />}
      {budget && <BudgetPanel budget={budget} />}
    </div>
  )
}
