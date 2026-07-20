import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { loadBudgetVsActual } from '@/lib/actuals.server'

// Budget-vs-actual rollup: actuals are APPROVED-only, variance matches hand-computed,
// lumpsum earned = % × BHD, drafts/submitted excluded from actuals.
const prisma = new PrismaClient()
const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const ids: { userId?: string; projectId?: string; baseCoat?: string; scaffold?: string } = {}

beforeAll(async () => {
  const [mason, cement] = await Promise.all([
    prisma.laborCategory.findFirstOrThrow({ where: { name: 'Mason' } }),
    prisma.material.findFirstOrThrow({ where: { name: 'OPC Cement' } }),
  ])
  const user = await prisma.user.create({ data: { userCode: `TSTA-U-${sfx}`, email: `tsta_${sfx}@e.local`, passwordHash: 'x', firstName: 'A', lastName: 'B', role: 'SUPERVISOR' } })
  ids.userId = user.id
  const project = await prisma.project.create({ data: { projectCode: `TSTA-P-${sfx}`, name: `Act ${sfx}`, status: 'ACTIVE', createdBy: user.id } })
  ids.projectId = project.id
  const asset = await prisma.asset.create({ data: { projectId: project.id, name: 'Villa A' } })

  // EIFS @ 1000 m2: measured base coat (Mason 0.3/m2 → 300 budget hrs, Cement 0.5/m2 → 500) + lumpsum scaffolding 2500.
  const activity = await prisma.activity.create({
    data: {
      assetId: asset.id, name: 'EIFS', unit: 'm2', boqQuantity: 1000,
      subActivities: {
        create: [
          { name: 'Base coat', type: 'MEASURED', sortOrder: 0, manpowerBudget: { create: [{ laborCategoryId: mason.id, hoursPerUnit: 0.3 }] }, materialBudget: { create: [{ materialId: cement.id, qtyPerUnit: 0.5 }] } },
          { name: 'Scaffolding', type: 'LUMPSUM', lumpsumBhd: 2500, sortOrder: 1 },
        ],
      },
    },
    include: { subActivities: true },
  })
  ids.baseCoat = activity.subActivities.find((s) => s.name === 'Base coat')!.id
  ids.scaffold = activity.subActivities.find((s) => s.name === 'Scaffolding')!.id

  const mk = (code: string, date: string, status: 'APPROVED' | 'SUBMITTED' | 'DRAFT', measuredQty: number, masonHeadcount: number, cementQty: number, scaffoldPct: number) =>
    prisma.dailyReport.create({
      data: {
        reportCode: code, projectId: project.id, authorId: user.id, reportDate: new Date(`${date}T00:00:00.000Z`), status,
        activities: {
          create: [{
            activityId: activity.id,
            subActivities: {
              create: [
                { subActivityId: ids.baseCoat!, quantityDone: measuredQty, manpower: { create: [{ categoryId: mason.id, headcount: masonHeadcount, hours: 1 }] }, materials: { create: [{ materialId: cement.id, quantity: cementQty }] } },
                { subActivityId: ids.scaffold!, percentComplete: scaffoldPct },
              ],
            },
          }],
        },
      },
    })

  // R1 APPROVED: base coat 300 (Mason 300 man-hrs, Cement 400), scaffolding 40%.
  await mk(`TSTA-${sfx}-R1`, '2026-06-01', 'APPROVED', 300, 300, 400, 40)
  // R2 SUBMITTED and R3 DRAFT: huge numbers that must NOT reach actuals.
  await mk(`TSTA-${sfx}-R2`, '2026-06-02', 'SUBMITTED', 100, 999, 999, 90)
  await mk(`TSTA-${sfx}-R3`, '2026-06-03', 'DRAFT', 500, 999, 999, 99)
})

afterAll(async () => {
  await prisma.dailyReport.deleteMany({ where: { reportCode: { startsWith: `TSTA-${sfx}` } } })
  if (ids.projectId) await prisma.project.deleteMany({ where: { id: ids.projectId } })
  if (ids.userId) await prisma.user.deleteMany({ where: { id: ids.userId } })
  await prisma.$disconnect()
})

describe('loadBudgetVsActual — reconcile', () => {
  it('rolls up APPROVED-only actuals with hand-computed variance + lumpsum earned', async () => {
    const bva = (await loadBudgetVsActual(ids.projectId!))!
    expect(bva).not.toBeNull()
    const act = bva.assets[0]!.activities[0]!

    const mason = act.measured.labour.find((l) => l.name === 'Mason')!
    expect(mason.budget).toBe(300) // 0.3 × 1000
    expect(mason.actual).toBe(300) // R1 only: 300×1; R2/R3 excluded
    expect(mason.consumedPct).toBe(100)
    expect(mason.light).toBe('amber')

    const cement = act.measured.materials.find((m) => m.name === 'OPC Cement')!
    expect(cement.budget).toBe(500) // 0.5 × 1000
    expect(cement.actual).toBe(400) // R1 only
    expect(cement.consumedPct).toBe(80)
    expect(cement.light).toBe('green')

    // Lumpsum earned = 40% × 2500 = 1000 (latest APPROVED %); physical % = base coat 300/1000 = 30.
    expect(act.lumpsumBudgetBhd).toBe(2500)
    expect(act.lumpsumEarnedBhd).toBe(1000)
    expect(act.physicalPercent).toBe(30)
  })

  it('project totals mirror the single activity (drafts/submitted excluded)', async () => {
    const bva = (await loadBudgetVsActual(ids.projectId!))!
    expect(bva.totals.labour.find((l) => l.name === 'Mason')!.actual).toBe(300)
    expect(bva.totals.lumpsumEarnedBhd).toBe(1000)
    expect(bva.totals.physicalPercent).toBe(30)
  })
})
