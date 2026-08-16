import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { recordConsumptionOnSubmit } from '@/lib/consumption/consumption.server'

// DB-backed: consumption written on submit from the placed budget rate × reported progress.
const prisma = new PrismaClient()
const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const ids: Record<string, string> = {}

const record = (reportId: string) => prisma.$transaction((tx) => recordConsumptionOnSubmit(tx, reportId, ids.projectId!))

beforeAll(async () => {
  const user = await prisma.user.create({ data: { userCode: `TSTC-U-${sfx}`, email: `tstc_${sfx}@e.local`, passwordHash: 'x', firstName: 'Con', lastName: 'Sumer', role: 'SUPERVISOR' } })
  ids.userId = user.id
  const project = await prisma.project.create({ data: { projectCode: `TSTC-P-${sfx}`, name: `Consumption ${sfx}`, createdBy: user.id } })
  ids.projectId = project.id
  const asset = await prisma.asset.create({ data: { projectId: project.id, name: 'Tower A' } })
  const material = await prisma.material.create({ data: { name: `Cement ${sfx}`, unit: 'bag' } })
  ids.materialId = material.id

  // Activity A has a material budget rate (0.28 bag/m²); Activity B has none.
  const actA = await prisma.activity.create({ data: { assetId: asset.id, name: 'Blockwork', unit: 'm2', boqQuantity: 500, subActivities: { create: [{ name: '__implicit__', type: 'MEASURED', isImplicit: true }] } }, include: { subActivities: true } })
  ids.subA = actA.subActivities[0]!.id
  const budget = await prisma.subActivityMaterialBudget.create({ data: { subActivityId: ids.subA, materialId: material.id, qtyPerUnit: 0.28 } })
  ids.budgetId = budget.id
  const actB = await prisma.activity.create({ data: { assetId: asset.id, name: 'Rendering', unit: 'm2', boqQuantity: 300, subActivities: { create: [{ name: '__implicit__', type: 'MEASURED', isImplicit: true }] } }, include: { subActivities: true } })
  ids.subB = actB.subActivities[0]!.id

  const mkReport = async (code: string, date: string, subId: string, quantityDone: number, entry?: { qty: number; touched: boolean }) => {
    const rep = await prisma.dailyReport.create({
      data: {
        reportCode: code, projectId: project.id, authorId: user.id, reportDate: new Date(`${date}T00:00:00.000Z`), status: 'DRAFT',
        activities: { create: [{ activityId: subId === ids.subA ? actA.id : actB.id, subActivities: { create: [{ subActivityId: subId, quantityDone, materials: entry ? { create: [{ materialId: material.id, quantity: entry.qty, quantityTouched: entry.touched }] } : undefined }] } }] },
      },
    })
    return rep.id
  }
  ids.reportEstimated = await mkReport(`DRC-${sfx}-E`, '2026-06-01', ids.subA, 70) // no material row → estimate
  ids.reportActual = await mkReport(`DRC-${sfx}-A`, '2026-06-02', ids.subA, 70, { qty: 18, touched: true }) // edited
  ids.reportPrefilled = await mkReport(`DRC-${sfx}-P`, '2026-06-03', ids.subA, 70, { qty: 20, touched: false }) // untouched pre-fill (rounded 20 stored)
  ids.reportNoRate = await mkReport(`DRC-${sfx}-N`, '2026-06-04', ids.subB, 50)
})

afterAll(async () => {
  if (ids.projectId) await prisma.inventoryAlert.deleteMany({ where: { projectId: ids.projectId } })
  await prisma.dailyReport.deleteMany({ where: { reportCode: { startsWith: `DRC-${sfx}` } } }) // cascades entries + activities
  if (ids.projectId) await prisma.project.deleteMany({ where: { id: ids.projectId } }) // cascades asset → activity → sub → budget
  if (ids.materialId) await prisma.material.deleteMany({ where: { id: ids.materialId } })
  if (ids.userId) await prisma.user.deleteMany({ where: { id: ids.userId } })
  await prisma.$disconnect()
})

describe('consumption written on submit', () => {
  it('untouched (no row) → ESTIMATED with the exact unrounded quantity and the snapshotted rate', async () => {
    const res = await record(ids.reportEstimated!)
    expect(res.entries).toBe(1)
    const entry = await prisma.consumptionEntry.findFirst({ where: { dailyReportId: ids.reportEstimated } })
    expect(entry!.source).toBe('ESTIMATED')
    expect(Number(entry!.quantity)).toBe(19.6) // 0.28 × 70, exact — not 20
    expect(Number(entry!.estimateRate)).toBe(0.28)
    expect(entry!.unit).toBe('bag')
    expect(entry!.projectId).toBe(ids.projectId)
  })

  it('untouched pre-filled row (stored rounded 20) → ESTIMATED with the EXACT recomputed 19.6', async () => {
    await record(ids.reportPrefilled!)
    const entry = await prisma.consumptionEntry.findFirst({ where: { dailyReportId: ids.reportPrefilled } })
    expect(entry!.source).toBe('ESTIMATED')
    expect(Number(entry!.quantity)).toBe(19.6) // recomputed exact, ignoring the stored rounded 20
  })

  it('edited (touched) → ACTUAL with the typed value', async () => {
    await record(ids.reportActual!)
    const entry = await prisma.consumptionEntry.findFirst({ where: { dailyReportId: ids.reportActual } })
    expect(entry!.source).toBe('ACTUAL')
    expect(Number(entry!.quantity)).toBe(18)
    expect(Number(entry!.estimateRate)).toBe(0.28) // rate still recorded for comparison
  })

  it('a later catalogue-rate change does not alter an existing entry', async () => {
    await prisma.subActivityMaterialBudget.update({ where: { id: ids.budgetId }, data: { qtyPerUnit: 0.5 } })
    const entry = await prisma.consumptionEntry.findFirst({ where: { dailyReportId: ids.reportEstimated } })
    expect(Number(entry!.quantity)).toBe(19.6) // unchanged
    expect(Number(entry!.estimateRate)).toBe(0.28) // unchanged
  })

  it('no budget rate → no consumption entry + exactly one MISSING_CONSUMPTION_RATE alert, idempotent', async () => {
    const first = await record(ids.reportNoRate!)
    expect(first.entries).toBe(0)
    expect(first.missingRateAlerts).toBe(1)
    expect(await prisma.consumptionEntry.count({ where: { dailyReportId: ids.reportNoRate } })).toBe(0)

    const subReport = await prisma.reportSubActivity.findFirst({ where: { reportActivity: { reportId: ids.reportNoRate } }, select: { id: true } })
    const alerts = await prisma.inventoryAlert.findMany({ where: { type: 'MISSING_CONSUMPTION_RATE', sourceRecordId: subReport!.id } })
    expect(alerts.length).toBe(1)

    const again = await record(ids.reportNoRate!)
    expect(again.missingRateAlerts).toBe(0)
    expect((await prisma.inventoryAlert.findMany({ where: { type: 'MISSING_CONSUMPTION_RATE', sourceRecordId: subReport!.id } })).length).toBe(1)
  })
})
