import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireAdminPage } from '@/lib/auth/permissions'
import { ScopeManager, type ScopeAssetData, type CatalogOption } from '@/components/admin/ScopeManager'
import { BudgetPanel } from '@/components/admin/BudgetPanel'
import { serializeScopeActivity, scopeActivitySelect } from '@/lib/scope'
import { loadProjectBudget } from '@/lib/budget.server'

export const dynamic = 'force-dynamic'

const UNIT_SUGGESTIONS = ['m2', 'm3', 'LM', 'm', 'no', 'ton', 'kg', 'lot', 'sum', 'hr', 'day']

export default async function ProjectDetailPage({ params }: { params: { id: string } }) {
  await requireAdminPage()

  const project = await prisma.project.findUnique({
    where: { id: params.id },
    select: { id: true, projectCode: true, name: true, location: true, status: true },
  })
  if (!project) notFound()

  const [assets, catalog, budget] = await Promise.all([
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
  ])

  const serialized: ScopeAssetData[] = assets.map((a) => ({
    id: a.id, ref: a.ref, name: a.name, description: a.description, isActive: a.isActive, sortOrder: a.sortOrder,
    activities: a.activities.map(serializeScopeActivity),
  }))
  const catalogOptions: CatalogOption[] = catalog.map((c) => ({
    id: c.id, name: c.name, type: c.type, unit: c.unit, lumpsumBhd: c.lumpsumBhd == null ? null : Number(c.lumpsumBhd),
  }))

  return (
    <div className="space-y-5">
      <div>
        <Link href="/admin/projects" className="text-sm font-medium text-primary hover:underline">
          ← Projects
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-fg">{project.name}</h1>
        <p className="mono text-sm text-fg-subtle">
          {project.projectCode}
          {project.location ? ` · ${project.location}` : ''}
        </p>
      </div>

      <ScopeManager
        projectId={project.id}
        assets={serialized}
        unitSuggestions={UNIT_SUGGESTIONS}
        catalogOptions={catalogOptions}
      />

      {budget && <BudgetPanel budget={budget} />}
    </div>
  )
}
