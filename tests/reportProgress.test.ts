import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { loadFormScope, activityLedger } from '@/lib/reports/progress'

// Per SUB-ACTIVITY committed/earned/remaining + the activity ledger (folded across subs).
const prisma = new PrismaClient()
const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const ids: { userId?: string; projectId?: string; activityId?: string; subId?: string } = {}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { userCode: `TSTP-U-${sfx}`, email: `tstp_${sfx}@e.local`, passwordHash: 'x', firstName: 'Prog', lastName: 'Author', role: 'SUPERVISOR' },
  })
  ids.userId = user.id
  const project = await prisma.project.create({ data: { projectCode: `TSTP-P-${sfx}`, name: `Progress ${sfx}`, createdBy: user.id } })
  ids.projectId = project.id
  const asset = await prisma.asset.create({ data: { projectId: project.id, name: 'Tower A' } })
  const activity = await prisma.activity.create({
    data: {
      assetId: asset.id, name: 'Blockwork 200mm', unit: 'm2', boqQuantity: 500,
      subActivities: { create: [{ name: '__implicit__', type: 'MEASURED', isImplicit: true }] },
    },
    include: { subActivities: true },
  })
  ids.activityId = activity.id
  ids.subId = activity.subActivities[0]!.id

  const mk = async (code: string, date: string, status: 'APPROVED' | 'SUBMITTED' | 'DRAFT', qty: number) => {
    await prisma.dailyReport.create({
      data: {
        reportCode: code, projectId: project.id, authorId: user.id, reportDate: new Date(`${date}T00:00:00.000Z`), status,
        activities: { create: [{ activityId: activity.id, subActivities: { create: [{ subActivityId: ids.subId!, quantityDone: qty }] } }] },
      },
    })
  }
  await mk(`TSTP-${sfx}-R1`, '2026-06-01', 'APPROVED', 100)
  await mk(`TSTP-${sfx}-R2`, '2026-06-02', 'SUBMITTED', 50)
  await mk(`TSTP-${sfx}-R3`, '2026-06-03', 'DRAFT', 999)
})

afterAll(async () => {
  await prisma.dailyReport.deleteMany({ where: { reportCode: { startsWith: `TSTP-${sfx}` } } })
  if (ids.projectId) await prisma.project.deleteMany({ where: { id: ids.projectId } })
  if (ids.userId) await prisma.user.deleteMany({ where: { id: ids.userId } })
  await prisma.$disconnect()
})

describe('committed vs earned + remaining (loadFormScope, per sub-activity)', () => {
  it('committed = SUBMITTED+APPROVED; earned = APPROVED-only; drafts excluded', async () => {
    const scope = await loadFormScope(ids.projectId!)
    const sub = scope.flatMap((a) => a.activities).flatMap((a) => a.subActivities).find((s) => s.id === ids.subId)!
    expect(sub.committed).toBe(150) // 100 approved + 50 submitted (999 draft excluded)
    expect(sub.earned).toBe(100)
    expect(sub.boqQuantity).toBe(500)
    expect(sub.remaining).toBe(350)
  })

  it('excluding the current report drops its committed quantity from the cap', async () => {
    const r2 = await prisma.dailyReport.findFirst({ where: { reportCode: `TSTP-${sfx}-R2` } })
    const scope = await loadFormScope(ids.projectId!, r2!.id)
    const sub = scope.flatMap((a) => a.activities).flatMap((a) => a.subActivities).find((s) => s.id === ids.subId)!
    expect(sub.committed).toBe(100)
    expect(sub.remaining).toBe(400)
  })
})

describe('activityLedger (folded across sub-activities)', () => {
  it('lists SUBMITTED+APPROVED in date order with a running committed cumulative', async () => {
    const ledger = await activityLedger(ids.activityId!)
    expect(ledger).not.toBeNull()
    expect(ledger!.entries.map((e) => e.quantityDone)).toEqual([100, 50])
    expect(ledger!.entries.map((e) => e.cumulative)).toEqual([100, 150])
    expect(ledger!.entries.map((e) => e.status)).toEqual(['APPROVED', 'SUBMITTED'])
  })
  it('header shows earned (APPROVED-only) qty, %, remaining', async () => {
    const ledger = await activityLedger(ids.activityId!)
    expect(ledger!.header.earned).toBe(100)
    expect(ledger!.header.committed).toBe(150)
    expect(ledger!.header.percent).toBe(20)
    expect(ledger!.header.remaining).toBe(350)
  })
})
