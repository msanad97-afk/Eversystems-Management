import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { loadDashboard } from '@/lib/dashboard.server'

// Integration: seed activity-structured reports and assert the dashboard KPIs (man-hours,
// coverage, materials — SUBMITTED+APPROVED) AND progress (earned — APPROVED-only) match
// hand-computed totals, with DRAFT excluded from everything.
const prisma = new PrismaClient()
const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const ids: { userId?: string; projectId?: string } = {}

const D0 = '2026-06-10', D1 = '2026-06-09', D2 = '2026-06-08'
const civ = (s: string) => new Date(`${s}T00:00:00.000Z`)

beforeAll(async () => {
  const [mason, helper, cement] = await Promise.all([
    prisma.laborCategory.findFirstOrThrow({ where: { name: 'Mason' } }),
    prisma.laborCategory.findFirstOrThrow({ where: { name: 'Helper/Labourer' } }),
    prisma.material.findFirstOrThrow({ where: { name: 'OPC Cement' } }),
  ])

  const user = await prisma.user.create({
    data: { userCode: `TSTD-U-${sfx}`, email: `tstd_${sfx}@e.local`, passwordHash: 'x', firstName: 'D', lastName: 'A', role: 'SUPERVISOR' },
  })
  ids.userId = user.id
  const project = await prisma.project.create({ data: { projectCode: `TSTD-P-${sfx}`, name: `Recon ${sfx}`, status: 'ACTIVE', createdBy: user.id } })
  ids.projectId = project.id
  const asset = await prisma.asset.create({ data: { projectId: project.id, name: 'Tower A' } })
  const act1 = await prisma.activity.create({ data: { assetId: asset.id, name: 'Blockwork', unit: 'm2', boqQuantity: 100 } })
  const act2 = await prisma.activity.create({ data: { assetId: asset.id, name: 'Concrete', unit: 'm3', boqQuantity: 50 } })

  const mk = (code: string, date: string, status: 'APPROVED' | 'SUBMITTED' | 'DRAFT', acts: { activityId: string; qty: number; manpower?: { categoryId: string; headcount: number; hours: number }[]; materials?: { materialId: string; quantity: number }[] }[]) =>
    prisma.dailyReport.create({
      data: {
        reportCode: code, projectId: project.id, authorId: user.id, reportDate: civ(date), status,
        activities: {
          create: acts.map((a) => ({
            activityId: a.activityId,
            quantityDone: a.qty,
            manpower: { create: a.manpower ?? [] },
            materials: { create: a.materials ?? [] },
          })),
        },
      },
    })

  // R1 APPROVED (d0): Act1 30 (Mason 10×8), Act2 20 (Helper 3×8, Cement 5)
  await mk(`TSTD-${sfx}-R1`, D0, 'APPROVED', [
    { activityId: act1.id, qty: 30, manpower: [{ categoryId: mason.id, headcount: 10, hours: 8 }] },
    { activityId: act2.id, qty: 20, manpower: [{ categoryId: helper.id, headcount: 3, hours: 8 }], materials: [{ materialId: cement.id, quantity: 5 }] },
  ])
  // R2 SUBMITTED (d1): Act1 10 (Mason 2×8)
  await mk(`TSTD-${sfx}-R2`, D1, 'SUBMITTED', [{ activityId: act1.id, qty: 10, manpower: [{ categoryId: mason.id, headcount: 2, hours: 8 }] }])
  // R3 DRAFT (d2): Act1 999 (Mason 100×8, Cement 999) — excluded everywhere
  await mk(`TSTD-${sfx}-R3`, D2, 'DRAFT', [{ activityId: act1.id, qty: 999, manpower: [{ categoryId: mason.id, headcount: 100, hours: 8 }], materials: [{ materialId: cement.id, quantity: 999 }] }])
})

afterAll(async () => {
  await prisma.dailyReport.deleteMany({ where: { reportCode: { startsWith: `TSTD-${sfx}` } } })
  if (ids.projectId) await prisma.project.deleteMany({ where: { id: ids.projectId } })
  if (ids.userId) await prisma.user.deleteMany({ where: { id: ids.userId } })
  await prisma.$disconnect()
})

describe('dashboard reconcile — activity-sourced KPIs + progress', () => {
  it('KPIs count SUBMITTED+APPROVED across activities; drafts excluded', async () => {
    const d = await loadDashboard({ projectId: ids.projectId!, from: D2, to: D0 })
    // R1 (10×8 + 3×8 = 104) + R2 (2×8 = 16) = 120; draft's 800 excluded
    expect(d.kpis.totalManHours).toBe(120)
    // distinct (project,date) with a counted report: d0, d1 = 2; expected 1 project × 3 days
    expect(d.kpis.reportsSubmitted).toBe(2)
    expect(d.kpis.reportsExpected).toBe(3)
    const cement = d.materialTotals.find((m) => m.materialName === 'OPC Cement')
    expect(cement?.total).toBe(5) // draft's 999 excluded
  })

  it('progress uses APPROVED-only earned; physical % = mean of activity %s', async () => {
    const d = await loadDashboard({ projectId: ids.projectId!, from: D2, to: D0 })
    expect(d.progress).toHaveLength(1)
    const p = d.progress[0]!
    const acts = p.assets.flatMap((a) => a.activities)
    const blockwork = acts.find((a) => a.name === 'Blockwork')!
    const concrete = acts.find((a) => a.name === 'Concrete')!
    // Blockwork earned = 30 (R1 approved only; R2 submitted 10 and R3 draft 999 excluded)
    expect(blockwork.earned).toBe(30)
    expect(blockwork.percent).toBe(30)
    expect(concrete.earned).toBe(20)
    expect(concrete.percent).toBe(40)
    // physical % = (30 + 40) / 2 = 35
    expect(p.physicalPercent).toBe(35)
  })
})
