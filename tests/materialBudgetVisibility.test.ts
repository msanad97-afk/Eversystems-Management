import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { loadFormScope } from '@/lib/reports/progress'

// Supervisor material-budget visibility: loadFormScope must expose qtyPerUnit + approved
// consumption per material, and MUST NOT leak any cost field from SubActivityMaterialBudget
// (costRateAtPlacement sits on the same row) across the supervisor money wall.
const prisma = new PrismaClient()
const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const ids: { userId?: string; projectId?: string; subId?: string; materialId?: string } = {}

// A distinctive cost value we can grep for in the payload — if it appears, the wall leaked.
const SECRET_COST = 987.654

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { userCode: `TSTM-U-${sfx}`, email: `tstm_${sfx}@e.local`, passwordHash: 'x', firstName: 'Mat', lastName: 'Author', role: 'SUPERVISOR' },
  })
  ids.userId = user.id
  const project = await prisma.project.create({ data: { projectCode: `TSTM-P-${sfx}`, name: `Material ${sfx}`, createdBy: user.id } })
  ids.projectId = project.id
  const asset = await prisma.asset.create({ data: { projectId: project.id, name: 'Tower A' } })
  const activity = await prisma.activity.create({
    data: {
      assetId: asset.id, name: 'EIFS', unit: 'm2', boqQuantity: 100,
      subActivities: { create: [{ name: '__implicit__', type: 'MEASURED', isImplicit: true }] },
    },
    include: { subActivities: true },
  })
  ids.subId = activity.subActivities[0]!.id

  const material = await prisma.material.create({ data: { name: `EPS board ${sfx}`, unit: 'sheets' } })
  ids.materialId = material.id

  // Budgeted rate 5 sheets/m² → total budget = 5 × 100 = 500 sheets. Cost sits on the same row.
  await prisma.subActivityMaterialBudget.create({
    data: { subActivityId: ids.subId!, materialId: material.id, qtyPerUnit: 5, costRateAtPlacement: SECRET_COST },
  })

  // One APPROVED (30, counts), one SUBMITTED (7, excluded), one DRAFT (999, excluded).
  const mk = async (code: string, date: string, status: 'APPROVED' | 'SUBMITTED' | 'DRAFT', qtyDone: number, matQty: number) => {
    await prisma.dailyReport.create({
      data: {
        reportCode: code, projectId: project.id, authorId: user.id, reportDate: new Date(`${date}T00:00:00.000Z`), status,
        activities: {
          create: [{
            activityId: activity.id,
            subActivities: { create: [{ subActivityId: ids.subId!, quantityDone: qtyDone, materials: { create: [{ materialId: material.id, quantity: matQty }] } }] },
          }],
        },
      },
    })
  }
  await mk(`TSTM-${sfx}-R1`, '2026-06-01', 'APPROVED', 10, 30)
  await mk(`TSTM-${sfx}-R2`, '2026-06-02', 'SUBMITTED', 10, 7)
  await mk(`TSTM-${sfx}-R3`, '2026-06-03', 'DRAFT', 10, 999)
})

afterAll(async () => {
  await prisma.dailyReport.deleteMany({ where: { reportCode: { startsWith: `TSTM-${sfx}` } } })
  if (ids.projectId) await prisma.project.deleteMany({ where: { id: ids.projectId } }) // cascades asset→activity→sub→budget
  if (ids.materialId) await prisma.material.deleteMany({ where: { id: ids.materialId } })
  if (ids.userId) await prisma.user.deleteMany({ where: { id: ids.userId } })
  await prisma.$disconnect()
})

function findBudgetMaterial() {
  return loadFormScope(ids.projectId!).then((scope) => {
    const sub = scope.flatMap((a) => a.activities).flatMap((a) => a.subActivities).find((s) => s.id === ids.subId)!
    return { sub, mat: sub.budgetMaterials.find((b) => b.materialId === ids.materialId)! }
  })
}

describe('material budget visibility — quantities exposed', () => {
  it('exposes qtyPerUnit + unit for the budgeted material', async () => {
    const { mat } = await findBudgetMaterial()
    expect(mat.qtyPerUnit).toBe(5)
    expect(mat.unit).toBe('sheets')
  })

  it('approvedConsumed sums APPROVED only (SUBMITTED + DRAFT excluded)', async () => {
    const { mat } = await findBudgetMaterial()
    expect(mat.approvedConsumed).toBe(30) // 30 approved; 7 submitted + 999 draft excluded
  })
})

describe('the supervisor money wall — no cost leaks into the payload', () => {
  it('the budget material line carries no cost field', async () => {
    const { mat } = await findBudgetMaterial()
    expect(Object.keys(mat).sort()).toEqual(['approvedConsumed', 'materialId', 'materialName', 'qtyPerUnit', 'unit'])
    expect(mat).not.toHaveProperty('costRateAtPlacement')
  })

  it('no cost key or cost value appears anywhere in the supervisor scope payload', async () => {
    const scope = await loadFormScope(ids.projectId!)
    const serialized = JSON.stringify(scope)
    expect(serialized).not.toContain('costRateAtPlacement')
    expect(serialized).not.toContain('rateAtApproval')
    expect(serialized).not.toContain('costAtApproval')
    expect(serialized).not.toContain(String(SECRET_COST))
  })
})
