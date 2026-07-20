import { prisma } from '@/lib/prisma'
import { requireAdminPage } from '@/lib/auth/permissions'
import { CatalogsClient } from './CatalogsClient'
import { serializeCatalogActivity, catalogActivitySelect } from '@/lib/catalog/payload'

export const dynamic = 'force-dynamic'

export default async function AdminCatalogsPage() {
  await requireAdminPage()

  const [laborRows, materialRows, activities] = await Promise.all([
    prisma.laborCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, isActive: true, sortOrder: true, hourlyRate: true },
    }),
    prisma.material.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, unit: true, isActive: true, sortOrder: true, unitRate: true },
    }),
    prisma.catalogActivity.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: catalogActivitySelect,
    }),
  ])

  // Decimals → numbers for the client (page is already ADMIN-gated).
  const labor = laborRows.map((l) => ({ ...l, hourlyRate: l.hourlyRate == null ? null : Number(l.hourlyRate) }))
  const materials = materialRows.map((m) => ({ ...m, unitRate: m.unitRate == null ? null : Number(m.unitRate) }))

  return (
    <CatalogsClient
      labor={labor}
      materials={materials}
      activities={activities.map(serializeCatalogActivity)}
      laborOptions={labor.filter((l) => l.isActive).map((l) => ({ id: l.id, name: l.name }))}
      materialOptions={materials.filter((m) => m.isActive).map((m) => ({ id: m.id, name: m.name, unit: m.unit }))}
    />
  )
}
