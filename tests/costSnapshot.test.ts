import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { snapshotReportCosts } from '@/lib/reports/costSnapshot'
import { loadProjectCostPerformance } from '@/lib/cost.server'

/**
 * Phase 6B — approval-time cost snapshot + Actual Cost rollup.
 * Priced entries are costed at the LIVE rate; unpriced ones stay null and are surfaced
 * rather than silently costing real work at zero.
 */
const prisma = new PrismaClient()
const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const MASON = `CsMason-${sfx}`
const PAINTER = `CsPainter-${sfx}` // deliberately UNPRICED
const CEMENT = `CsCement-${sfx}`
const ids: { userId?: string; projectId?: string; reportId?: string; activityId?: string; subId?: string } = {}

beforeAll(async () => {
  const mason = await prisma.laborCategory.create({ data: { name: MASON, hourlyRate: 2 } })
  const painter = await prisma.laborCategory.create({ data: { name: PAINTER } }) // no hourlyRate
  const cement = await prisma.material.create({ data: { name: CEMENT, unit: 'bag', unitRate: 1.5 } })

  const user = await prisma.user.create({ data: { userCode: `CS-U-${sfx}`, email: `cs_${sfx}@e.local`, passwordHash: 'x', firstName: 'C', lastName: 'S', role: 'SUPERVISOR' } })
  ids.userId = user.id
  const project = await prisma.project.create({ data: { projectCode: `CS-P-${sfx}`, name: `Cost ${sfx}`, status: 'ACTIVE', createdBy: user.id, budgetCost: null } })
  ids.projectId = project.id
  const asset = await prisma.asset.create({ data: { projectId: project.id, name: 'Tower A' } })
  const activity = await prisma.activity.create({
    data: {
      assetId: asset.id, name: 'Blockwork', unit: 'm2', boqQuantity: 500,
      subActivities: { create: [{ name: '__implicit__', type: 'MEASURED', isImplicit: true }] },
    },
    include: { subActivities: true },
  })
  ids.activityId = activity.id
  ids.subId = activity.subActivities[0]!.id

  // SUBMITTED report: Mason 10×8 (=80 hrs), Painter 2×8 (unpriced), Cement 20 bags.
  const report = await prisma.dailyReport.create({
    data: {
      reportCode: `CS-${sfx}-R1`, projectId: project.id, authorId: user.id,
      reportDate: new Date('2026-06-01T00:00:00.000Z'), status: 'SUBMITTED',
      activities: {
        create: [{
          activityId: activity.id,
          subActivities: {
            create: [{
              subActivityId: ids.subId!,
              quantityDone: 50,
              manpower: { create: [{ categoryId: mason.id, headcount: 10, hours: 8 }, { categoryId: painter.id, headcount: 2, hours: 8 }] },
              materials: { create: [{ materialId: cement.id, quantity: 20 }] },
            }],
          },
        }],
      },
    },
  })
  ids.reportId = report.id
})

afterAll(async () => {
  // Reports and expenses hold FKs to the project, so they go first.
  if (ids.projectId) {
    await prisma.dailyReport.deleteMany({ where: { projectId: ids.projectId } })
    await prisma.expense.deleteMany({ where: { projectId: ids.projectId } })
    await prisma.project.deleteMany({ where: { id: ids.projectId } })
  }
  await prisma.laborCategory.deleteMany({ where: { name: { in: [MASON, PAINTER] } } })
  await prisma.material.deleteMany({ where: { name: CEMENT } })
  if (ids.userId) await prisma.user.deleteMany({ where: { id: ids.userId } })
  await prisma.$disconnect()
})

describe('cost snapshot on approval', () => {
  it('costs priced entries at the live rate and leaves unpriced ones null', async () => {
    const res = await prisma.$transaction((tx) => snapshotReportCosts(tx, ids.reportId!))
    // Mason 10×8×2 = 160; Cement 20×1.5 = 30 → 190. Painter has no rate → skipped.
    expect(res.totalCost).toBe(190)
    expect(res.pricedManpower).toBe(1)
    expect(res.unpricedManpower).toBe(1)
    expect(res.pricedMaterial).toBe(1)

    const entries = await prisma.manpowerEntry.findMany({
      where: { reportSubActivity: { subActivityId: ids.subId! } },
      select: { costAtApproval: true, rateAtApproval: true, category: { select: { name: true } } },
    })
    const masonRow = entries.find((e) => e.category.name === MASON)!
    const painterRow = entries.find((e) => e.category.name === PAINTER)!
    expect(Number(masonRow.costAtApproval)).toBe(160)
    expect(Number(masonRow.rateAtApproval)).toBe(2)
    expect(painterRow.costAtApproval).toBeNull() // real work, costed at zero — must be flagged
  })

  it('is write-once: re-running never overwrites an approval-time cost', async () => {
    // Raise the global rate, then snapshot again — the frozen cost must not move.
    await prisma.laborCategory.updateMany({ where: { name: MASON }, data: { hourlyRate: 50 } })
    const again = await prisma.$transaction((tx) => snapshotReportCosts(tx, ids.reportId!))
    expect(again.pricedManpower).toBe(0) // nothing left to price
    const masonRow = await prisma.manpowerEntry.findFirst({
      where: { category: { name: MASON }, reportSubActivity: { subActivityId: ids.subId! } },
      select: { costAtApproval: true },
    })
    expect(Number(masonRow!.costAtApproval)).toBe(160) // unchanged
  })
})

describe('Actual Cost rollup', () => {
  it('excludes non-approved reports entirely', async () => {
    const cost = (await loadProjectCostPerformance(ids.projectId!))!
    expect(cost.fieldCost).toBe(0) // still SUBMITTED
    expect(cost.actualCost).toBe(0)
  })

  it('counts approved field cost and surfaces the zero-costed entry', async () => {
    await prisma.dailyReport.update({ where: { id: ids.reportId! }, data: { status: 'APPROVED' } })
    const cost = (await loadProjectCostPerformance(ids.projectId!))!
    expect(cost.fieldCost).toBe(190)
    expect(cost.actualCost).toBe(190)
    expect(cost.unpriced).toHaveLength(1)
    expect(cost.unpriced[0]).toMatchObject({ kind: 'LABOUR', resourceName: PAINTER })
    expect(cost.hasApproximations).toBe(false)
  })

  it('adds eligible expenses and excludes MATERIALS_DIRECT / HEAD_OFFICE_OVERHEAD', async () => {
    await prisma.expense.createMany({
      data: [
        { projectId: ids.projectId!, category: 'SUBCONTRACTOR', description: 'Sub', amount: 100, expenseDate: new Date('2026-06-02T00:00:00Z'), createdBy: ids.userId! },
        { projectId: ids.projectId!, category: 'MATERIALS_DIRECT', description: 'Double-count risk', amount: 999, expenseDate: new Date('2026-06-02T00:00:00Z'), createdBy: ids.userId! },
        { projectId: ids.projectId!, category: 'HEAD_OFFICE_OVERHEAD', description: 'HO', amount: 777, expenseDate: new Date('2026-06-02T00:00:00Z'), createdBy: ids.userId! },
      ],
    })
    const cost = (await loadProjectCostPerformance(ids.projectId!))!
    expect(cost.expenseCost).toBe(100) // only the subcontractor
    expect(cost.actualCost).toBe(290) // 190 field + 100
    expect(cost.expenses.excludedTotal).toBe(1776) // 999 + 777, visible but not counted
    expect(cost.expenses.excluded.every((e) => e.exclusionReason !== null)).toBe(true)
  })

  it('marks backfilled reports as approximations', async () => {
    await prisma.dailyReport.update({ where: { id: ids.reportId! }, data: { costBackfilledAt: new Date() } })
    const cost = (await loadProjectCostPerformance(ids.projectId!))!
    expect(cost.hasApproximations).toBe(true)
    expect(cost.approximatedCost).toBe(190)
    expect(cost.activities.find((a) => a.activityId === ids.activityId)!.approximated).toBe(true)
  })
})
