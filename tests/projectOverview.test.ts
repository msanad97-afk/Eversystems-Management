import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { loadProjectOverview } from '@/lib/projectOverview.server'
import { loadBudgetVsActual } from '@/lib/actuals.server'

// DB-backed: the per-activity progress MATRIX. One activity ("Facade") placed on two assets, with a
// sparse sub-activity grid, a lumpsum sub, and recent-vs-old approved progress for the 7-day flag.
const prisma = new PrismaClient()
const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const ids: Record<string, string> = {}

// Dates on the same UTC boundary the loader uses. OLD < cutoff (counts as baseline); RECENT is inside
// the 7-day window (moves a cell).
const now = new Date()
const OLD = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 30))
const RECENT = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1))

beforeAll(async () => {
  const user = await prisma.user.create({ data: { userCode: `TPO-U-${sfx}`, email: `tpo_${sfx}@e.local`, passwordHash: 'x', firstName: 'O', lastName: 'V', role: 'ADMIN' } })
  ids.userId = user.id
  const cat = await prisma.laborCategory.create({ data: { name: `Mason ${sfx}`, hourlyRate: 10 } })
  const project = await prisma.project.create({ data: { projectCode: `TPO-P-${sfx}`, name: `Overview ${sfx}`, status: 'ACTIVE', createdBy: user.id } })
  ids.projectId = project.id

  const towerA = await prisma.asset.create({ data: { projectId: project.id, name: 'Tower A', ref: 'A', sortOrder: 0 } })
  const towerB = await prisma.asset.create({ data: { projectId: project.id, name: 'Tower B', ref: 'B', sortOrder: 1 } })
  await prisma.asset.create({ data: { projectId: project.id, name: 'Tower C (inactive)', isActive: false, sortOrder: 2 } }) // excluded

  const mp = { create: [{ laborCategoryId: cat.id, hoursPerUnit: 1, costRateAtPlacement: 10 }] }

  // "Facade" on Tower A: Coat (w60) + Trim (w40), boq 100.
  const facadeA = await prisma.activity.create({
    data: {
      assetId: towerA.id, name: 'Facade', ref: '3.1', unit: 'm2', boqQuantity: 100, billRate: 777, sortOrder: 0,
      subActivities: { create: [
        { name: 'Coat', type: 'MEASURED', sortOrder: 0, weightPct: 60, manpowerBudget: mp },
        { name: 'Trim', type: 'MEASURED', sortOrder: 1, weightPct: 40, manpowerBudget: mp },
      ] },
    },
    include: { subActivities: true },
  })
  // "Facade" on Tower B: Coat (w60) + Scaffold LUMPSUM (w40), boq 200. No Trim → sparse grid.
  const facadeB = await prisma.activity.create({
    data: {
      assetId: towerB.id, name: 'Facade', ref: '3.1', unit: 'm2', boqQuantity: 200, billRate: 777, sortOrder: 0,
      subActivities: { create: [
        { name: 'Coat', type: 'MEASURED', sortOrder: 0, weightPct: 60, manpowerBudget: mp },
        { name: 'Scaffold', type: 'LUMPSUM', lumpsumBhd: 1000, sortOrder: 2, weightPct: 40 },
      ] },
    },
    include: { subActivities: true },
  })
  // Inactive activity under Tower A — excluded.
  await prisma.activity.create({ data: { assetId: towerA.id, name: 'Old works', unit: 'm2', boqQuantity: 50, isActive: false, sortOrder: 1 } })

  const coatA = facadeA.subActivities.find((s) => s.name === 'Coat')!.id
  const trimA = facadeA.subActivities.find((s) => s.name === 'Trim')!.id
  const coatB = facadeB.subActivities.find((s) => s.name === 'Coat')!.id
  const scaffoldB = facadeB.subActivities.find((s) => s.name === 'Scaffold')!.id

  // OLD (baseline): Coat A 30/100, Trim A 25/100, Coat B 40/200, Scaffold B 50%.
  await prisma.dailyReport.create({
    data: {
      reportCode: `TPO-DR-${sfx}-OLD`, projectId: project.id, authorId: user.id, reportDate: OLD, status: 'APPROVED',
      activities: { create: [
        { activityId: facadeA.id, subActivities: { create: [{ subActivityId: coatA, quantityDone: 30 }, { subActivityId: trimA, quantityDone: 25 }] } },
        { activityId: facadeB.id, subActivities: { create: [{ subActivityId: coatB, quantityDone: 40 }, { subActivityId: scaffoldB, percentComplete: 50 }] } },
      ] },
    },
  })
  // RECENT (last 7 days): Coat A +20 (→50), Scaffold B →80%. Trim A and Coat B unchanged.
  await prisma.dailyReport.create({
    data: {
      reportCode: `TPO-DR-${sfx}-NEW`, projectId: project.id, authorId: user.id, reportDate: RECENT, status: 'APPROVED',
      activities: { create: [
        { activityId: facadeA.id, subActivities: { create: [{ subActivityId: coatA, quantityDone: 20 }] } },
        { activityId: facadeB.id, subActivities: { create: [{ subActivityId: scaffoldB, percentComplete: 80 }] } },
      ] },
    },
  })
})

afterAll(async () => {
  await prisma.dailyReport.deleteMany({ where: { reportCode: { startsWith: `TPO-DR-${sfx}` } } })
  if (ids.projectId) await prisma.project.deleteMany({ where: { id: ids.projectId } }) // cascades assets→activities→subs
  await prisma.laborCategory.deleteMany({ where: { name: { startsWith: `Mason ${sfx}` } } })
  if (ids.userId) await prisma.user.deleteMany({ where: { id: ids.userId } })
  await prisma.$disconnect()
})

describe('loadProjectOverview — progress matrix', () => {
  it('returns one table per active activity with the right assets, sub-activities and weights', async () => {
    const o = (await loadProjectOverview(ids.projectId!))!
    expect(o.matrix).toHaveLength(1) // one activity ("Facade"), grouped across the two towers
    const m = o.matrix[0]!
    expect(m.name).toBe('Facade')
    // Columns = union of non-implicit subs by name, ordered by sortOrder: Coat(0), Trim(1), Scaffold(2).
    expect(m.columns.map((c) => c.name)).toEqual(['Coat', 'Trim', 'Scaffold'])
    expect(m.columns.map((c) => c.weightPct)).toEqual([60, 40, 40])
    expect(m.columns.find((c) => c.name === 'Scaffold')!.type).toBe('LUMPSUM')
    // Rows = both active assets carrying the activity (inactive Tower C excluded).
    expect(m.rows.map((r) => r.assetName)).toEqual(['Tower A', 'Tower B'])
    expect(m.rows[0]!.boqQuantity).toBe(100)
    expect(m.rows[1]!.boqQuantity).toBe(200)
  })

  it("a cell's value matches that sub-activity's cumulative % for that asset", async () => {
    const o = (await loadProjectOverview(ids.projectId!))!
    const m = o.matrix[0]!
    const [coat, trim, scaffold] = m.columns.map((c) => c.key)
    const rowA = m.rows[0]!, rowB = m.rows[1]!
    const cellA = (k: string) => rowA.cells[m.columns.findIndex((c) => c.key === k)]
    const cellB = (k: string) => rowB.cells[m.columns.findIndex((c) => c.key === k)]
    expect(cellA(coat!)!.percent).toBe(50) // 50/100
    expect(cellA(trim!)!.percent).toBe(25) // 25/100
    expect(cellB(coat!)!.percent).toBe(20) // 40/200
    expect(cellB(scaffold!)!.percent).toBe(80) // lumpsum latest %
  })

  it('the total column equals the existing weighted physical %', async () => {
    const o = (await loadProjectOverview(ids.projectId!))!
    const bva = (await loadBudgetVsActual(ids.projectId!))!
    const m = o.matrix[0]!
    // Weighted: Tower A (50·60 + 25·40)/100 = 40; Tower B (20·60 + 80·40)/100 = 44.
    expect(m.rows[0]!.totalPercent).toBe(40)
    expect(m.rows[1]!.totalPercent).toBe(44)
    // …and it is the SAME figure loadBudgetVsActual computes per activity (reused, not recomputed).
    const bvaPct = bva.assets.flatMap((a) => a.activities).filter((a) => a.name === 'Facade').map((a) => a.physicalPercent).sort((x, y) => x - y)
    expect(bvaPct).toEqual([40, 44])
  })

  it("a sub-activity not in an asset's scope renders as absent (null), not 0", async () => {
    const o = (await loadProjectOverview(ids.projectId!))!
    const m = o.matrix[0]!
    const iTrim = m.columns.findIndex((c) => c.name === 'Trim')
    const iScaffold = m.columns.findIndex((c) => c.name === 'Scaffold')
    expect(m.rows[0]!.cells[iScaffold]).toBeNull() // Tower A has no Scaffold → absent, not 0
    expect(m.rows[1]!.cells[iTrim]).toBeNull() // Tower B has no Trim → absent, not 0
    // The present cells are NOT null (a real 0 would still be an object).
    expect(m.rows[0]!.cells[iTrim]).not.toBeNull()
    expect(m.rows[1]!.cells[iScaffold]).not.toBeNull()
  })

  it('flags a cell that rose in the last 7 days with its delta; leaves an unchanged one unflagged', async () => {
    const o = (await loadProjectOverview(ids.projectId!))!
    const m = o.matrix[0]!
    const cell = (row: number, name: string) => m.rows[row]!.cells[m.columns.findIndex((c) => c.name === name)]
    expect(cell(0, 'Coat')!.delta).toBe(20) // 30 → 50 in the recent report
    expect(cell(1, 'Scaffold')!.delta).toBe(30) // 50% → 80% recently
    expect(cell(0, 'Trim')!.delta).toBeNull() // only an OLD report → no recent rise
    expect(cell(1, 'Coat')!.delta).toBeNull() // unchanged in the window
  })

  it('carries NO cost field anywhere in the matrix branch', async () => {
    const o = (await loadProjectOverview(ids.projectId!))!
    const m = o.matrix[0]!
    expect(Object.keys(m).sort()).toEqual(['columns', 'key', 'name', 'ref', 'rows'])
    expect(Object.keys(m.columns[0]!).sort()).toEqual(['key', 'name', 'type', 'weightPct'])
    expect(Object.keys(m.rows[0]!).sort()).toEqual(['assetId', 'assetName', 'assetRef', 'boqQuantity', 'cells', 'totalDelta', 'totalPercent', 'unit'])
    const cell = m.rows[0]!.cells.find((c) => c != null)!
    expect(Object.keys(cell).sort()).toEqual(['delta', 'percent'])
    // The Object.keys checks above are the real guarantee. This string scan is a backstop against
    // cost FIELD names leaking; every token carries an uppercase letter so none can match a random
    // lowercase cuid (a bare numeric or lowercase token could — that's what made an earlier check flaky).
    const s = JSON.stringify(o.matrix)
    for (const token of ['BHD', 'lumpsumBhd', 'costRate', 'costRateAtPlacement', 'contractValue', 'billRate', 'lumpsumEarnedBhd', 'lumpsumBudgetBhd']) {
      expect(s).not.toContain(token)
    }
  })
})
