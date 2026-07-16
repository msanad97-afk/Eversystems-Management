import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { loadReportableScope, activityLedger } from '@/lib/reports/progress'

const prisma = new PrismaClient()
const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const ids: { userId?: string; projectId?: string; activityId?: string } = {}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { userCode: `TSTP-U-${sfx}`, email: `tstp_${sfx}@e.local`, passwordHash: 'x', firstName: 'Prog', lastName: 'Author', role: 'SUPERVISOR' },
  })
  ids.userId = user.id
  const project = await prisma.project.create({
    data: { projectCode: `TSTP-P-${sfx}`, name: `Progress ${sfx}`, createdBy: user.id },
  })
  ids.projectId = project.id
  const asset = await prisma.asset.create({ data: { projectId: project.id, name: 'Tower A' } })
  const activity = await prisma.activity.create({
    data: { assetId: asset.id, name: 'Blockwork 200mm', unit: 'm2', boqQuantity: 500 },
  })
  ids.activityId = activity.id

  // R1 APPROVED qty 100 (2026-06-01), R2 SUBMITTED qty 50 (2026-06-02), R3 DRAFT qty 999 (2026-06-03).
  const mk = async (code: string, date: string, status: 'APPROVED' | 'SUBMITTED' | 'DRAFT', qty: number) => {
    await prisma.dailyReport.create({
      data: {
        reportCode: code, projectId: project.id, authorId: user.id,
        reportDate: new Date(`${date}T00:00:00.000Z`), status,
        activities: { create: [{ activityId: activity.id, quantityDone: qty }] },
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

describe('committed vs earned + remaining (loadReportableScope)', () => {
  it('committed = SUBMITTED+APPROVED; earned = APPROVED-only; drafts excluded', async () => {
    const scope = await loadReportableScope(ids.projectId!)
    const act = scope.flatMap((a) => a.activities).find((a) => a.id === ids.activityId)!
    expect(act.committed).toBe(150) // 100 approved + 50 submitted (999 draft excluded)
    expect(act.earned).toBe(100) // approved only
    expect(act.boqQuantity).toBe(500)
    expect(act.remaining).toBe(350) // 500 − 150
  })

  it('excluding the current report drops its committed quantity from the cap', async () => {
    const r2 = await prisma.dailyReport.findFirst({ where: { reportCode: `TSTP-${sfx}-R2` } })
    const scope = await loadReportableScope(ids.projectId!, r2!.id)
    const act = scope.flatMap((a) => a.activities).find((a) => a.id === ids.activityId)!
    expect(act.committed).toBe(100) // R2's 50 excluded
    expect(act.remaining).toBe(400)
  })
})

describe('activityLedger', () => {
  it('lists SUBMITTED+APPROVED in date order with a running committed cumulative', async () => {
    const ledger = await activityLedger(ids.activityId!)
    expect(ledger).not.toBeNull()
    expect(ledger!.entries.map((e) => e.quantityDone)).toEqual([100, 50]) // date order, draft excluded
    expect(ledger!.entries.map((e) => e.cumulative)).toEqual([100, 150]) // running committed
    expect(ledger!.entries.map((e) => e.status)).toEqual(['APPROVED', 'SUBMITTED'])
  })

  it('header shows earned (APPROVED-only) qty, %, and remaining', async () => {
    const ledger = await activityLedger(ids.activityId!)
    expect(ledger!.header.earned).toBe(100)
    expect(ledger!.header.committed).toBe(150)
    expect(ledger!.header.percent).toBe(20) // 100/500
    expect(ledger!.header.remaining).toBe(350)
  })
})
