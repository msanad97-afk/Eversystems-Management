import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireAdminPage } from '@/lib/auth/permissions'
import { ScopeManager, type ScopeAssetData } from '@/components/admin/ScopeManager'

export const dynamic = 'force-dynamic'

const UNIT_SUGGESTIONS = ['m2', 'm3', 'LM', 'm', 'no', 'ton', 'kg', 'lot', 'sum', 'hr', 'day']

export default async function ProjectDetailPage({ params }: { params: { id: string } }) {
  await requireAdminPage()

  const project = await prisma.project.findUnique({
    where: { id: params.id },
    select: { id: true, projectCode: true, name: true, location: true, status: true },
  })
  if (!project) notFound()

  const assets = await prisma.asset.findMany({
    where: { projectId: project.id },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true, ref: true, name: true, description: true, isActive: true, sortOrder: true,
      activities: {
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, ref: true, name: true, unit: true, boqQuantity: true, isActive: true, sortOrder: true },
      },
    },
  })

  const serialized: ScopeAssetData[] = assets.map((a) => ({
    ...a,
    activities: a.activities.map((x) => ({ ...x, boqQuantity: Number(x.boqQuantity) })),
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

      <ScopeManager projectId={project.id} assets={serialized} unitSuggestions={UNIT_SUGGESTIONS} />
    </div>
  )
}
