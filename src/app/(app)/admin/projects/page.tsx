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
        contractValue: true,
        budgetCost: true,
        retentionPct: true,
        retentionCapPct: true,
        advancePct: true,
        paymentTermsDays: true,
        currency: true,
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

  // Decimal → string ('' when null) so the edit form prefills exactly what is stored and an
  // unchanged save round-trips the same value — never blanking a project's financials.
  const dec = (v: unknown): string => (v == null ? '' : String(v))
  const serialized = projects.map((p) => ({
    id: p.id,
    projectCode: p.projectCode,
    name: p.name,
    location: p.location ?? '',
    status: p.status,
    startDate: p.startDate ? p.startDate.toISOString().slice(0, 10) : '',
    members: p.members.map((m) => m.user),
    hasScope: p._count.assets > 0,
    financials: {
      contractValue: dec(p.contractValue),
      budgetCost: dec(p.budgetCost),
      retentionPct: dec(p.retentionPct),
      retentionCapPct: dec(p.retentionCapPct),
      advancePct: dec(p.advancePct),
      paymentTermsDays: p.paymentTermsDays == null ? '' : String(p.paymentTermsDays),
      currency: p.currency ?? '',
    },
  }))

  return <ProjectsClient projects={serialized} users={users} />
}
