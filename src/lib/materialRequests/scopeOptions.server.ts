import { prisma } from '@/lib/prisma'
import type { ProjectScopeOption, MatOption } from '@/components/materialRequests/types'

/**
 * Scope pickers + material catalogue for the request form. Supervisor-facing, so it selects
 * NO cost field (Material.unitRate is never read here). Projects are limited to the ones the
 * supervisor is assigned to; assets/activities are the active scope within each.
 */
export async function loadSupervisorScopeOptions(
  userId: string,
): Promise<{ projects: ProjectScopeOption[]; materials: MatOption[] }> {
  const [memberships, materials] = await Promise.all([
    prisma.projectMember.findMany({
      where: { userId },
      select: {
        project: {
          select: {
            id: true,
            name: true,
            projectCode: true,
            assets: {
              where: { isActive: true },
              orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
              select: {
                id: true,
                name: true,
                activities: {
                  where: { isActive: true },
                  orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
                  select: { id: true, ref: true, name: true },
                },
              },
            },
          },
        },
      },
    }),
    prisma.material.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, unit: true, isActive: true },
    }),
  ])

  const projects: ProjectScopeOption[] = memberships
    .map((m) => m.project)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ id: p.id, name: p.name, projectCode: p.projectCode, assets: p.assets }))

  return { projects, materials }
}
