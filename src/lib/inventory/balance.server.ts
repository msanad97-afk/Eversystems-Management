import type { Prisma, PrismaClient } from '@prisma/client'

/**
 * The ONE derived material-balance helper (Stage 2C-2).
 *
 *   on_hand = Σ DeliveryLine.quantity − Σ ConsumptionEntry.quantity   (per project, per material)
 *
 * The balance is NEVER stored — it is always derived here, so the stock-count entry screen and the
 * inventory page agree by construction (do not compute this anywhere else). Consumption is summed
 * across ALL sources (ESTIMATED + ACTUAL + COUNT_ADJUSTMENT); the estimated/actual split is reported
 * separately as a trust indicator. Quantities only — NO cost is read on this path.
 */

export interface MaterialBalance {
  projectId: string
  materialId: string
  materialName: string
  unit: string
  delivered: number
  consumed: number
  onHand: number
  estimatedPortion: number // Σ consumption where source = ESTIMATED
  actualPortion: number // Σ consumption where source = ACTUAL
  lastCountedAt: Date | null
}

type Db = Prisma.TransactionClient | PrismaClient

const round3 = (n: number) => Math.round(n * 1000) / 1000

interface Acc {
  projectId: string
  materialId: string
  delivered: number
  consumed: number
  estimated: number
  actual: number
  lastCountedAt: Date | null
}

/** Balances for every material seen (delivered, consumed, or counted) across the given projects. */
export async function loadMaterialBalances(db: Db, projectIds: string[]): Promise<MaterialBalance[]> {
  if (projectIds.length === 0) return []

  const [deliveryLines, consumption, countLines] = await Promise.all([
    // DeliveryLine carries no projectId — reach it through delivery → dailyReport.
    db.deliveryLine.findMany({
      where: { delivery: { dailyReport: { projectId: { in: projectIds } } } },
      select: { materialId: true, quantity: true, delivery: { select: { dailyReport: { select: { projectId: true } } } } },
    }),
    db.consumptionEntry.groupBy({
      by: ['projectId', 'materialId', 'source'],
      where: { projectId: { in: projectIds } },
      _sum: { quantity: true },
    }),
    db.stockCountLine.findMany({
      where: { stockCount: { projectId: { in: projectIds } } },
      select: { materialId: true, stockCount: { select: { projectId: true, countedAt: true } } },
    }),
  ])

  const acc = new Map<string, Acc>()
  const key = (p: string, m: string) => `${p}::${m}`
  const ensure = (projectId: string, materialId: string): Acc => {
    const k = key(projectId, materialId)
    let row = acc.get(k)
    if (!row) {
      row = { projectId, materialId, delivered: 0, consumed: 0, estimated: 0, actual: 0, lastCountedAt: null }
      acc.set(k, row)
    }
    return row
  }

  for (const dl of deliveryLines) {
    ensure(dl.delivery.dailyReport.projectId, dl.materialId).delivered += Number(dl.quantity)
  }
  for (const c of consumption) {
    const row = ensure(c.projectId, c.materialId)
    const q = Number(c._sum.quantity ?? 0)
    row.consumed += q
    if (c.source === 'ESTIMATED') row.estimated += q
    else if (c.source === 'ACTUAL') row.actual += q
  }
  for (const l of countLines) {
    const row = ensure(l.stockCount.projectId, l.materialId)
    if (!row.lastCountedAt || l.stockCount.countedAt > row.lastCountedAt) row.lastCountedAt = l.stockCount.countedAt
  }

  const materialIds = [...new Set([...acc.values()].map((r) => r.materialId))]
  const materials = await db.material.findMany({ where: { id: { in: materialIds } }, select: { id: true, name: true, unit: true } })
  const mById = new Map(materials.map((m) => [m.id, m]))

  return [...acc.values()]
    .map((r): MaterialBalance => {
      const m = mById.get(r.materialId)
      return {
        projectId: r.projectId,
        materialId: r.materialId,
        materialName: m?.name ?? '(unknown material)',
        unit: m?.unit ?? '',
        delivered: round3(r.delivered),
        consumed: round3(r.consumed),
        onHand: round3(r.delivered - r.consumed),
        estimatedPortion: round3(r.estimated),
        actualPortion: round3(r.actual),
        lastCountedAt: r.lastCountedAt,
      }
    })
    .sort((a, b) => a.materialName.localeCompare(b.materialName))
}

/** One project's balances keyed by materialId — for the stock-count entry screen and its save snapshot. */
export async function loadProjectBalanceMap(db: Db, projectId: string): Promise<Map<string, MaterialBalance>> {
  const rows = await loadMaterialBalances(db, [projectId])
  return new Map(rows.map((r) => [r.materialId, r]))
}
