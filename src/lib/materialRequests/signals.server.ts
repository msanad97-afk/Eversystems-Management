import { prisma } from '@/lib/prisma'
import { loadProjectBudget, loadActivityBudget } from '@/lib/budget.server'
import type { MaterialBudgetLine } from '@/lib/budget'

/**
 * Budgeted-vs-requested signals for a request scope — QUANTITIES ONLY. This is the
 * supervisor-facing projection: it reads material quantities and unit from the cost-free
 * budget rollup ({@link loadProjectBudget}/{@link loadActivityBudget} expose no cost field)
 * and sums request quantities. It NEVER reads Material.unitRate or costRateAtPlacement — cost
 * lives only in cost.server.ts (ADMIN). Keep it that way; the money wall depends on it.
 */

export interface RequestScope {
  projectId: string
  assetId?: string | null
  activityId?: string | null
}

export interface MaterialSignal {
  materialId: string
  materialName: string
  unit: string
  /** Σ qtyPerUnit × boqQuantity across the chosen scope, or null = "no budget set". */
  budgetedQty: number | null
  /** Σ approvedQty of prior reviewed (APPROVED/PARTIALLY_APPROVED) requests at this scope grain. */
  requestedSoFar: number
  /** Σ requestedQty of SUBMITTED-but-not-reviewed requests at this scope grain (shown separately). */
  pending: number
}

/** Pick the budgeted material lines for the chosen scope grain (project / asset / activity). */
async function budgetedMaterials(scope: RequestScope): Promise<MaterialBudgetLine[]> {
  if (scope.activityId) {
    const b = await loadActivityBudget(scope.activityId)
    return b?.totals.materials ?? []
  }
  const project = await loadProjectBudget(scope.projectId)
  if (!project) return []
  if (scope.assetId) {
    const asset = project.assets.find((a) => a.assetId === scope.assetId)
    return asset?.totals.materials ?? []
  }
  return project.totals.materials
}

/**
 * Assemble per-material signals for a scope. `excludeRequestId` drops the request being
 * edited/reviewed from the cumulative figures so it never counts itself.
 */
export async function loadScopeSignals(
  scope: RequestScope,
  excludeRequestId?: string,
): Promise<MaterialSignal[]> {
  // Same-grain scope key: nulls match nulls, so a project-level request only sees other
  // project-level requests, an asset request only same-asset requests, etc.
  const requestWhere = {
    projectId: scope.projectId,
    assetId: scope.assetId ?? null,
    activityId: scope.activityId ?? null,
    ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
  }

  const [budget, approvedRows, pendingRows] = await Promise.all([
    budgetedMaterials(scope),
    prisma.materialRequestLine.groupBy({
      by: ['materialId'],
      where: { approvedQty: { not: null }, request: { ...requestWhere, status: { in: ['APPROVED', 'PARTIALLY_APPROVED'] } } },
      _sum: { approvedQty: true },
    }),
    prisma.materialRequestLine.groupBy({
      by: ['materialId'],
      where: { request: { ...requestWhere, status: 'SUBMITTED' } },
      _sum: { requestedQty: true },
    }),
  ])

  const approved = new Map(approvedRows.map((r) => [r.materialId, Number(r._sum.approvedQty ?? 0)]))
  const pending = new Map(pendingRows.map((r) => [r.materialId, Number(r._sum.requestedQty ?? 0)]))

  const byId = new Map<string, MaterialSignal>()
  for (const b of budget) {
    byId.set(b.materialId, {
      materialId: b.materialId,
      materialName: b.materialName,
      unit: b.materialUnit,
      budgetedQty: b.quantity,
      requestedSoFar: approved.get(b.materialId) ?? 0,
      pending: pending.get(b.materialId) ?? 0,
    })
  }

  // Materials with request history but no budget line → "no budget set" (budgetedQty null).
  const extraIds = [...new Set([...approved.keys(), ...pending.keys()])].filter((id) => !byId.has(id))
  if (extraIds.length > 0) {
    const mats = await prisma.material.findMany({ where: { id: { in: extraIds } }, select: { id: true, name: true, unit: true } })
    for (const m of mats) {
      byId.set(m.id, {
        materialId: m.id,
        materialName: m.name,
        unit: m.unit,
        budgetedQty: null,
        requestedSoFar: approved.get(m.id) ?? 0,
        pending: pending.get(m.id) ?? 0,
      })
    }
  }

  return [...byId.values()].sort((a, b) => a.materialName.localeCompare(b.materialName))
}
