import { prisma } from '@/lib/prisma'
import { requireAdminPage } from '@/lib/auth/permissions'
import { ProjectsClient } from './ProjectsClient'

export const dynamic = 'force-dynamic'

export default async function AdminProjectsPage() {
  await requireAdminPage()

  const [projects, users] = await Promise.all([
    prisma.project.findMany({
      orderBy: { projectCode: 'asc' },
      select: {
        id: true,
        projectCode: true,
        name: true,
        location: true,
        status: true,
        startDate: true,
        members: {
          select: {
            user: { select: { id: true, userCode: true, firstName: true, lastName: true, role: true } },
          },
        },
        _count: { select: { assets: { where: { isActive: true, activities: { some: { isActive: true } } } } } },
      },
    }),
    prisma.user.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { userCode: 'asc' },
      select: { id: true, userCode: true, firstName: true, lastName: true, role: true },
    }),
  ])

  const serialized = projects.map((p) => ({
    id: p.id,
    projectCode: p.projectCode,
    name: p.name,
    location: p.location ?? '',
    status: p.status,
    startDate: p.startDate ? p.startDate.toISOString().slice(0, 10) : '',
    members: p.members.map((m) => m.user),
    hasScope: p._count.assets > 0,
  }))

  return <ProjectsClient projects={serialized} users={users} />
}
