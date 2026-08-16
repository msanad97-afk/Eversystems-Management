import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { loadMaterialBalances } from '@/lib/inventory/balance.server'

// ─── View (read layer) ────────────────────────────────────────────────────────

export interface StockCountLineView {
  id: string
  materialId: string
  materialName: string
  countedQuantity: number
  systemQuantity: number
  variance: number
  unit: string
}
export interface StockCountView {
  id: string
  countedAt: string
  notes: string | null
  lines: StockCountLineView[]
}

/** The stock count entered on a report (at most one per report). Quantities only. */
export async function loadReportStockCount(reportId: string): Promise<StockCountView | null> {
  const count = await prisma.stockCount.findFirst({
    where: { dailyReportId: reportId },
    orderBy: { countedAt: 'desc' },
    select: {
      id: true,
      countedAt: true,
      notes: true,
      lines: {
        orderBy: { material: { name: 'asc' } },
        select: { id: true, materialId: true, countedQuantity: true, systemQuantity: true, variance: true, unit: true, material: { select: { name: true } } },
      },
    },
  })
  if (!count) return null
  return {
    id: count.id,
    countedAt: count.countedAt.toISOString(),
    notes: count.notes,
    lines: count.lines.map((l) => ({
      id: l.id,
      materialId: l.materialId,
      materialName: l.material.name,
      countedQuantity: Number(l.countedQuantity),
      systemQuantity: Number(l.systemQuantity),
      variance: Number(l.variance),
      unit: l.unit,
    })),
  }
}

// ─── Submit-time reconciliation ───────────────────────────────────────────────

const round3 = (n: number) => Math.round(n * 1000) / 1000

/**
 * On report submit: for each counted line with a non-zero variance, write a COUNT_ADJUSTMENT
 * ConsumptionEntry of quantity = system − counted (positive when material is missing, negative
 * when there is more than expected) so the derived balance reconciles to the counted figure, and
 * raise ONE COUNT_VARIANCE alert (idempotent by sourceRecordId = the StockCountLine id).
 *
 * Idempotent by dailyReportId: if COUNT_ADJUSTMENT entries already exist for this report, do
 * nothing — resubmitting never duplicates adjustments. History is never rewritten. Runs inside the
 * submit transaction.
 */
export async function reconcileStockCountsOnSubmit(
  tx: Prisma.TransactionClient,
  reportId: string,
  projectId: string,
): Promise<{ adjustments: number; varianceAlerts: number }> {
  const alreadyAdjusted = await tx.consumptionEntry.count({ where: { dailyReportId: reportId, source: 'COUNT_ADJUSTMENT' } })
  if (alreadyAdjusted > 0) return { adjustments: 0, varianceAlerts: 0 }

  const lines = await tx.stockCountLine.findMany({
    where: { stockCount: { dailyReportId: reportId } },
    select: { id: true, materialId: true, countedQuantity: true, systemQuantity: true, variance: true, unit: true },
  })
  const varied = lines.filter((l) => Number(l.variance) !== 0)
  if (varied.length === 0) return { adjustments: 0, varianceAlerts: 0 }

  await tx.consumptionEntry.createMany({
    data: varied.map((l) => ({
      dailyReportId: reportId,
      projectId,
      materialId: l.materialId,
      quantity: round3(Number(l.systemQuantity) - Number(l.countedQuantity)), // system − counted
      unit: l.unit,
      source: 'COUNT_ADJUSTMENT' as const,
      estimateRate: null,
      subActivityReportId: null,
    })),
  })

  const existing = await tx.inventoryAlert.findMany({
    where: { type: 'COUNT_VARIANCE', sourceRecordId: { in: varied.map((l) => l.id) } },
    select: { sourceRecordId: true },
  })
  const have = new Set(existing.map((e) => e.sourceRecordId))
  const toAlert = varied.filter((l) => !have.has(l.id))
  if (toAlert.length > 0) {
    await tx.inventoryAlert.createMany({
      data: toAlert.map((l) => ({ projectId, materialId: l.materialId, type: 'COUNT_VARIANCE' as const, quantity: l.variance, sourceRecordId: l.id, status: 'OPEN' as const })),
    })
  }

  return { adjustments: varied.length, varianceAlerts: toAlert.length }
}

/**
 * On report submit (after consumption + count adjustments are written): raise ONE NEGATIVE_BALANCE
 * alert per project+material whose derived balance is negative. A negative balance is information,
 * not a block. Not re-raised while an OPEN alert already exists for that project+material.
 */
export async function syncNegativeBalanceAlerts(tx: Prisma.TransactionClient, projectId: string): Promise<number> {
  const balances = await loadMaterialBalances(tx, [projectId])
  const negatives = balances.filter((b) => b.onHand < 0)
  if (negatives.length === 0) return 0

  const existing = await tx.inventoryAlert.findMany({
    where: { projectId, type: 'NEGATIVE_BALANCE', status: 'OPEN', materialId: { in: negatives.map((n) => n.materialId) } },
    select: { materialId: true },
  })
  const have = new Set(existing.map((e) => e.materialId))
  const toCreate = negatives.filter((n) => !have.has(n.materialId))
  if (toCreate.length === 0) return 0

  await tx.inventoryAlert.createMany({
    data: toCreate.map((n) => ({ projectId, materialId: n.materialId, type: 'NEGATIVE_BALANCE' as const, quantity: n.onHand, status: 'OPEN' as const })),
  })
  return toCreate.length
}
