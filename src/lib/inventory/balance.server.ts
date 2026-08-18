import type { Prisma, PrismaClient } from '@prisma/client'

/**
 * The ONE derived material-balance helper (Stage 2C-2).
 *
 *   on_hand = Σ DeliveryLine.quantity − Σ ConsumptionEntry.quantity   (per project, per material)
 *
 * The balance is NEVER stored — it is always derived here, so the stock-count entry screen and the
 * inventory page agree by construction (do not compute this anywhere else). `onHand` nets ALL
 * consumption sources (ESTIMATED + ACTUAL + COUNT_ADJUSTMENT) so it equals the last counted figure,
 * but the reported `consumed` deliberately EXCLUDES COUNT_ADJUSTMENT (those are reconciliations, not
 * usage) — the adjustment is surfaced on its own as `countAdjustment`. Quantities only — NO cost.
 */

export interface MaterialBalance {
  projectId: string
  materialId: string
  materialName: string
  unit: string
  delivered: number
  consumed: number // Σ ESTIMATED + ACTUAL only — real usage, never count adjustments
  onHand: number // delivered − ALL consumption (incl. adjustments) → equals the last counted figure
  estimatedPortion: number // Σ consumption where source = ESTIMATED
  actualPortion: number // Σ consumption where source = ACTUAL
  // Net count adjustment from the SITE's perspective: a count finding MORE than expected reads as a
  // surplus (+), finding LESS as a shortfall (−). The ledger stores each COUNT_ADJUSTMENT as
  // (system − counted), so this is the negation of their sum.
  countAdjustment: number
  lastCountedAt: Date | null
}

type Db = Prisma.TransactionClient | PrismaClient

const round3 = (n: number) => {
  const v = Math.round(n * 1000) / 1000
  return Object.is(v, -0) ? 0 : v // negating a zero adjustment must read as 0, not −0
}

interface Acc {
  projectId: string
  materialId: string
  delivered: number
  estimated: number
  actual: number
  countAdjLedger: number // Σ COUNT_ADJUSTMENT quantity as stored (system − counted)
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
      row = { projectId, materialId, delivered: 0, estimated: 0, actual: 0, countAdjLedger: 0, lastCountedAt: null }
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
    if (c.source === 'ESTIMATED') row.estimated += q
    else if (c.source === 'ACTUAL') row.actual += q
    else if (c.source === 'COUNT_ADJUSTMENT') row.countAdjLedger += q
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
      const consumed = r.estimated + r.actual // real usage only — excludes count adjustments
      return {
        projectId: r.projectId,
        materialId: r.materialId,
        materialName: m?.name ?? '(unknown material)',
        unit: m?.unit ?? '',
        delivered: round3(r.delivered),
        consumed: round3(consumed),
        onHand: round3(r.delivered - consumed - r.countAdjLedger), // nets adjustments → equals last count
        estimatedPortion: round3(r.estimated),
        actualPortion: round3(r.actual),
        countAdjustment: round3(-r.countAdjLedger), // site perspective: surplus +, shortfall −
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
