import { prisma } from '@/lib/prisma'
import { loadMaterialBalances, type MaterialBalance } from '@/lib/inventory/balance.server'

export interface InventoryProjectGroup {
  projectId: string
  projectName: string
  projectCode: string
  rows: MaterialBalance[]
}

/**
 * Inventory view for the ADMIN page (Stage 2C-2). Derived balances per material, grouped by project.
 * Scoped to one project when `projectId` is given, otherwise all ACTIVE projects. Quantities only —
 * NO cost, rate, or valuation is read on this path.
 */
export async function loadInventory(projectId?: string): Promise<InventoryProjectGroup[]> {
  const projects = await prisma.project.findMany({
    where: { status: 'ACTIVE', ...(projectId ? { id: projectId } : {}) },
    orderBy: { projectCode: 'asc' },
    select: { id: true, name: true, projectCode: true },
  })
  if (projects.length === 0) return []

  const balances = await loadMaterialBalances(prisma, projects.map((p) => p.id))
  const byProject = new Map<string, MaterialBalance[]>()
  for (const b of balances) {
    const list = byProject.get(b.projectId) ?? []
    list.push(b)
    byProject.set(b.projectId, list)
  }

  return projects.map((p) => ({
    projectId: p.id,
    projectName: p.name,
    projectCode: p.projectCode,
    rows: byProject.get(p.id) ?? [],
  }))
}
