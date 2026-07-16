import { prisma } from '@/lib/prisma'
import { requireAdminPage } from '@/lib/auth/permissions'
import { UsersClient } from './UsersClient'

export const dynamic = 'force-dynamic'

export default async function AdminUsersPage() {
  await requireAdminPage()

  const [users, projects] = await Promise.all([
    prisma.user.findMany({
      orderBy: { userCode: 'asc' },
      select: {
        id: true,
        userCode: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        lastLoginAt: true,
        projects: { select: { project: { select: { id: true, projectCode: true, name: true } } } },
      },
    }),
    prisma.project.findMany({
      orderBy: { projectCode: 'asc' },
      select: { id: true, projectCode: true, name: true },
    }),
  ])

  const serialized = users.map((u) => ({
    id: u.id,
    userCode: u.userCode,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    phone: u.phone ?? '',
    role: u.role,
    status: u.status,
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    projects: u.projects.map((p) => p.project),
  }))

  return <UsersClient users={serialized} projects={projects} />
}
