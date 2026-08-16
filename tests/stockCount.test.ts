import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { loadMaterialBalances } from '@/lib/inventory/balance.server'
import { loadInventory } from '@/lib/inventory/inventoryView.server'
import { reconcileStockCountsOnSubmit, syncNegativeBalanceAlerts } from '@/lib/inventory/stockCount.server'

// DB-backed: derived balance (deliveries − consumption), stock-count reconciliation, and the
// negative-balance alert. Quantities only — a distinctive cost value proves the money wall holds.
const prisma = new PrismaClient()
const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const SECRET_COST = 876.543
const ids: Record<string, string> = {}

const balanceOf = async (materialId: string) => {
  const rows = await loadMaterialBalances(prisma, [ids.projectId!])
  return rows.find((r) => r.materialId === materialId)
}

beforeAll(async () => {
  const user = await prisma.user.create({ data: { userCode: `TSTS-U-${sfx}`, email: `tsts_${sfx}@e.local`, passwordHash: 'x', firstName: 'Stock', lastName: 'Counter', role: 'SUPERVISOR' } })
  ids.userId = user.id
  const project = await prisma.project.create({ data: { projectCode: `TSTS-P-${sfx}`, name: `Stock ${sfx}`, createdBy: user.id } })
  ids.projectId = project.id
  const asset = await prisma.asset.create({ data: { projectId: project.id, name: 'Tower A' } })

  const cement = await prisma.material.create({ data: { name: `Cement ${sfx}`, unit: 'bag', unitRate: SECRET_COST } }) // cost lives on the row
  const sand = await prisma.material.create({ data: { name: `Sand ${sfx}`, unit: 'm3' } })
  const steel = await prisma.material.create({ data: { name: `Steel ${sfx}`, unit: 'kg' } })
  const paint = await prisma.material.create({ data: { name: `Paint ${sfx}`, unit: 'litre' } })
  ids.cement = cement.id; ids.sand = sand.id; ids.steel = steel.id; ids.paint = paint.id

  // Seed report carries the deliveries + consumption that establish the balances.
  const seed = await prisma.dailyReport.create({
    data: {
      reportCode: `TSTS-${sfx}-SEED`, projectId: project.id, authorId: user.id, reportDate: new Date('2026-06-01T00:00:00.000Z'), status: 'APPROVED',
      deliveries: {
        create: [{
          supplierName: 'ACME', deliveryNoteNumber: 'DN-1', createdById: user.id,
          lines: { create: [
            { materialId: cement.id, quantity: 100, unit: 'bag' },
            { materialId: sand.id, quantity: 50, unit: 'm3' },
            { materialId: steel.id, quantity: 20, unit: 'kg' },
            { materialId: paint.id, quantity: 10, unit: 'litre' },
          ] },
        }],
      },
    },
  })
  ids.seedReportId = seed.id

  const mkConsumption = (materialId: string, quantity: number, unit: string, source: 'ESTIMATED' | 'ACTUAL') =>
    prisma.consumptionEntry.create({ data: { dailyReportId: seed.id, projectId: project.id, materialId, quantity, unit, source } })
  await mkConsumption(cement.id, 30, 'bag', 'ESTIMATED')
  await mkConsumption(cement.id, 10, 'bag', 'ACTUAL')
  await mkConsumption(sand.id, 5, 'm3', 'ESTIMATED')
  await mkConsumption(steel.id, 8, 'kg', 'ESTIMATED')
  await mkConsumption(paint.id, 15, 'litre', 'ACTUAL') // 10 delivered − 15 consumed = −5 → negative
  // Balances now: cement 60, sand 45, steel 12, paint −5.

  // A report carrying a stock count: cement counted 55 (variance −5), sand counted 45 (variance 0).
  const countReport = await prisma.dailyReport.create({
    data: {
      reportCode: `TSTS-${sfx}-COUNT`, projectId: project.id, authorId: user.id, reportDate: new Date('2026-06-02T00:00:00.000Z'), status: 'DRAFT',
      stockCounts: {
        create: [{
          projectId: project.id, countedById: user.id,
          lines: { create: [
            { materialId: cement.id, countedQuantity: 55, systemQuantity: 60, variance: -5, unit: 'bag' },
            { materialId: sand.id, countedQuantity: 45, systemQuantity: 45, variance: 0, unit: 'm3' },
          ] },
        }],
      },
    },
    include: { stockCounts: { include: { lines: true } } },
  })
  ids.countReportId = countReport.id
  ids.cementLineId = countReport.stockCounts[0]!.lines.find((l) => l.materialId === cement.id)!.id
  ids.sandLineId = countReport.stockCounts[0]!.lines.find((l) => l.materialId === sand.id)!.id
})

afterAll(async () => {
  if (ids.projectId) await prisma.inventoryAlert.deleteMany({ where: { projectId: ids.projectId } })
  await prisma.dailyReport.deleteMany({ where: { reportCode: { startsWith: `TSTS-${sfx}` } } }) // cascades deliveries, consumption, counts
  if (ids.projectId) await prisma.project.deleteMany({ where: { id: ids.projectId } }) // cascades asset→activity→sub
  await prisma.material.deleteMany({ where: { id: { in: [ids.cement, ids.sand, ids.steel, ids.paint].filter((x): x is string => Boolean(x)) } } })
  if (ids.userId) await prisma.user.deleteMany({ where: { id: ids.userId } })
  await prisma.$disconnect()
})

describe('derived balance = deliveries − consumption', () => {
  it('computes on-hand, delivered, consumed, and the estimated/actual split per material', async () => {
    const cement = await balanceOf(ids.cement!)
    expect(cement).toMatchObject({ delivered: 100, consumed: 40, onHand: 60, estimatedPortion: 30, actualPortion: 10, unit: 'bag' })
    expect(cement!.lastCountedAt).not.toBeNull() // cement is in the count
    const steel = await balanceOf(ids.steel!)
    expect(steel).toMatchObject({ delivered: 20, consumed: 8, onHand: 12 })
    expect(steel!.lastCountedAt).toBeNull() // steel was never counted
  })
})

describe('stock-count reconciliation on submit', () => {
  it('a non-zero variance writes a COUNT_ADJUSTMENT that makes the derived balance equal the counted quantity', async () => {
    const res = await prisma.$transaction((tx) => reconcileStockCountsOnSubmit(tx, ids.countReportId!, ids.projectId!))
    expect(res).toEqual({ adjustments: 1, varianceAlerts: 1 })

    const adj = await prisma.consumptionEntry.findMany({ where: { dailyReportId: ids.countReportId, source: 'COUNT_ADJUSTMENT' } })
    expect(adj.length).toBe(1)
    expect(adj[0]!.materialId).toBe(ids.cement)
    expect(Number(adj[0]!.quantity)).toBe(5) // system 60 − counted 55 (positive: material missing)

    const cement = await balanceOf(ids.cement!)
    expect(cement!.onHand).toBe(55) // reconciled to the counted figure

    const alert = await prisma.inventoryAlert.findMany({ where: { type: 'COUNT_VARIANCE', sourceRecordId: ids.cementLineId } })
    expect(alert.length).toBe(1)
    expect(Number(alert[0]!.quantity)).toBe(-5) // counted − system
  })

  it('a zero-variance line writes no adjustment and no alert', async () => {
    const adj = await prisma.consumptionEntry.findFirst({ where: { dailyReportId: ids.countReportId, source: 'COUNT_ADJUSTMENT', materialId: ids.sand } })
    expect(adj).toBeNull()
    const alert = await prisma.inventoryAlert.findMany({ where: { type: 'COUNT_VARIANCE', sourceRecordId: ids.sandLineId } })
    expect(alert.length).toBe(0)
    expect((await balanceOf(ids.sand!))!.onHand).toBe(45) // unchanged
  })

  it('a material not in the count is unaffected (partial count)', async () => {
    expect((await balanceOf(ids.steel!))!.onHand).toBe(12) // no adjustment for steel
    expect(await prisma.consumptionEntry.count({ where: { dailyReportId: ids.countReportId, materialId: ids.steel } })).toBe(0)
  })

  it('re-submitting the report does not duplicate adjustments or alerts', async () => {
    const res = await prisma.$transaction((tx) => reconcileStockCountsOnSubmit(tx, ids.countReportId!, ids.projectId!))
    expect(res).toEqual({ adjustments: 0, varianceAlerts: 0 })
    expect(await prisma.consumptionEntry.count({ where: { dailyReportId: ids.countReportId, source: 'COUNT_ADJUSTMENT' } })).toBe(1)
    expect((await prisma.inventoryAlert.findMany({ where: { type: 'COUNT_VARIANCE', sourceRecordId: ids.cementLineId } })).length).toBe(1)
  })
})

describe('negative-balance alert', () => {
  it('raises exactly one NEGATIVE_BALANCE alert; re-running (resubmit / second report) never duplicates while OPEN', async () => {
    const first = await prisma.$transaction((tx) => syncNegativeBalanceAlerts(tx, ids.projectId!))
    expect(first).toBe(1) // only paint is negative (−5)

    const paintAlerts = await prisma.inventoryAlert.findMany({ where: { projectId: ids.projectId, type: 'NEGATIVE_BALANCE', materialId: ids.paint } })
    expect(paintAlerts.length).toBe(1)
    expect(Number(paintAlerts[0]!.quantity)).toBe(-5)

    const second = await prisma.$transaction((tx) => syncNegativeBalanceAlerts(tx, ids.projectId!))
    expect(second).toBe(0) // resubmit: OPEN alert already exists
    const third = await prisma.$transaction((tx) => syncNegativeBalanceAlerts(tx, ids.projectId!))
    expect(third).toBe(0) // a second report: still not duplicated
    expect((await prisma.inventoryAlert.count({ where: { projectId: ids.projectId, type: 'NEGATIVE_BALANCE' } }))).toBe(1)
  })
})

describe('the money wall — no cost on any inventory path', () => {
  it('neither the balance helper nor the inventory view leak a cost field or value', async () => {
    const balances = await loadMaterialBalances(prisma, [ids.projectId!])
    const inventory = await loadInventory(ids.projectId!)
    const serialized = JSON.stringify({ balances, inventory })
    expect(serialized).not.toContain(String(SECRET_COST))
    expect(serialized).not.toContain('unitRate')
    expect(serialized).not.toContain('costRate')
    expect(serialized).not.toContain('costAtApproval')
    // The balance row exposes only quantity fields.
    expect(Object.keys(balances[0]!).sort()).toEqual(
      ['actualPortion', 'consumed', 'delivered', 'estimatedPortion', 'lastCountedAt', 'materialId', 'materialName', 'onHand', 'projectId', 'unit'],
    )
  })
})
