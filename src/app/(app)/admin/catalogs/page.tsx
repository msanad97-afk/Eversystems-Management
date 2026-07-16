import { prisma } from '@/lib/prisma'
import { requireAdminPage } from '@/lib/auth/permissions'
import { CatalogsClient } from './CatalogsClient'

export const dynamic = 'force-dynamic'

export default async function AdminCatalogsPage() {
  await requireAdminPage()

  const [labor, materials] = await Promise.all([
    prisma.laborCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, isActive: true, sortOrder: true },
    }),
    prisma.material.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, unit: true, isActive: true, sortOrder: true },
    }),
  ])

  return <CatalogsClient labor={labor} materials={materials} />
}
