import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { loadRetentionBlock, loadForecast, retentionOutstanding, loadAllRetention } from '@/lib/cash.server'

/**
 * Phase 8 retention against a real database. The critical proof: `retentionHeld` is the LATEST
 * certified period's cumulative value, NOT a sum across periods.
 */
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(), recordAuditLog: vi.fn() }))

import { getServerSession } from 'next-auth'
import { POST as createTxn } from '@/app/api/cash/transactions/route'

const prisma = new PrismaClient()
const sfx = `RET-${Date.now()}`
const ids: Record<string, string> = {}
const utcDay = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) }

/** Create a certified valuation carrying a given cumulative retentionHeld. */
async function certifiedPeriod(periodMonth: string, code: string, retentionHeld: number, grossAmount: number) {
  return prisma.valuation.create({
    data: {
      valuationCode: code, projectId: ids.projectId!, periodMonth: new Date(`${periodMonth}T00:00:00.000Z`),
      revisionNumber: 0, status: 'CERTIFIED', certifiedAt: new Date(),
      progressPct: 50, cumulativeMeasured: grossAmount, cumulativeLumpsum: 0, grossAmount, previousGross: 0,
      retentionHeld, advanceRecovery: 0, netPayable: grossAmount - retentionHeld, createdBy: ids.userId!,
    },
  })
}

beforeAll(async () => {
  const admin = await prisma.user.create({ data: { userCode: `${sfx}-U`, email: `${sfx}@e.local`, passwordHash: 'x', firstName: 'R', lastName: 'T', role: 'ADMIN', status: 'ACTIVE' } })
  ids.userId = admin.id
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: admin.id } } as never)

  // Practical completion in the PAST so tranche 1 is due (for the forecast + attention tests).
  const pc = new Date(Date.UTC(utcDay().getUTCFullYear(), utcDay().getUTCMonth() - 2, 15))
  const project = await prisma.project.create({
    data: { projectCode: `${sfx}-P`, name: `Ret ${sfx}`, status: 'ACTIVE', createdBy: admin.id, currency: 'BHD',
      practicalCompletionDate: pc, defectsLiabilityMonths: 12, retentionFirstReleasePct: 50 },
  })
  ids.projectId = project.id
  const acc = await prisma.bankAccount.create({ data: { name: `${sfx}-Acc`, currency: 'BHD', openingBalance: 0, openingDate: new Date('2026-01-01T00:00:00.000Z'), createdBy: admin.id } })
  ids.accountId = acc.id

  // Three periods with CUMULATIVE retention 100 → 250 → 400. Held must be 400, not 750.
  await certifiedPeriod('2026-01-01', `${sfx}-V1`, 100, 1000)
  await certifiedPeriod('2026-02-01', `${sfx}-V2`, 250, 2500)
  await certifiedPeriod('2026-03-01', `${sfx}-V3`, 400, 4000)
})

afterAll(async () => {
  if (ids.projectId) {
    await prisma.cashTransaction.deleteMany({ where: { OR: [{ projectId: ids.projectId }, { accountId: ids.accountId }] } })
    await prisma.valuation.deleteMany({ where: { projectId: ids.projectId } })
    await prisma.project.deleteMany({ where: { id: ids.projectId } })
  }
  if (ids.accountId) await prisma.bankAccount.deleteMany({ where: { id: ids.accountId } })
  if (ids.userId) await prisma.user.deleteMany({ where: { id: ids.userId } })
  await prisma.$disconnect()
})

describe('retentionHeld is the LATEST period’s cumulative value, never a sum', () => {
  it('held = 400 (the third certificate), not 750 (the sum)', async () => {
    const block = (await loadRetentionBlock(ids.projectId!))!
    expect(block.held).toBe(400)
    expect(block.held).not.toBe(750)
    expect(block.outstanding).toBe(400)
    expect(block.tranche1.amount).toBe(200) // 50%
    expect(block.tranche2.amount).toBe(200)
  })
})

describe('release nets against held; over-release is a confirmable flag', () => {
  it('a partial release leaves the remainder', async () => {
    const req = (body: unknown) => new NextRequest('http://test/api/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const res = await createTxn(req({ accountId: ids.accountId, category: 'RETENTION_RELEASE', amount: 150, description: 'release 1', txnDate: '2026-04-01', projectId: ids.projectId }))
    expect(res.status).toBe(201)
    expect(await retentionOutstanding(ids.projectId!)).toBe(250) // 400 − 150
  })

  it('a release beyond outstanding is rejected with the figure named, until confirmed', async () => {
    const req = (body: unknown) => new NextRequest('http://test/api/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const blocked = await createTxn(req({ accountId: ids.accountId, category: 'RETENTION_RELEASE', amount: 999, description: 'too much', txnDate: '2026-04-02', projectId: ids.projectId }))
    expect(blocked.status).toBe(409)
    const data = await blocked.json()
    expect(data.requiresOverpayConfirm).toBe(true)
    expect(data.outstanding).toBe(250)

    const confirmed = await createTxn(req({ accountId: ids.accountId, category: 'RETENTION_RELEASE', amount: 999, description: 'over', txnDate: '2026-04-02', projectId: ids.projectId, allowOverpay: true }))
    expect(confirmed.status).toBe(201)
  })
})

describe('retention feeds the Phase 7 inflow forecast (scoped delta)', () => {
  it('outstanding dated retention raises projected inflow vs a baseline without it', async () => {
    // Reset releases so the project has clean outstanding retention with a past-due tranche 1.
    await prisma.cashTransaction.deleteMany({ where: { projectId: ids.projectId!, category: 'RETENTION_RELEASE' } })

    const today = utcDay()
    // Lower-bound invariants (company-wide forecast; other parallel test data only adds to it):
    // my tranche 1 (200) is past due → present in the first month's inflow.
    const withRet = await loadForecast(6, today)
    expect(withRet.months[0]!.projectedInflow).toBeGreaterThanOrEqual(200)

    // Null out the completion date → my 400 held becomes unscheduled, not bucketed into a month.
    await prisma.project.update({ where: { id: ids.projectId! }, data: { practicalCompletionDate: null } })
    try {
      const unscheduled = await loadForecast(6, today)
      expect(unscheduled.unscheduledRetention).toBeGreaterThanOrEqual(400)
    } finally {
      const pc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 2, 15))
      await prisma.project.update({ where: { id: ids.projectId! }, data: { practicalCompletionDate: pc } })
    }
  })
})

describe('executive attention flags retention due', () => {
  it('the RETENTION_DUE source (loadAllRetention.pastDue) reports my project’s past-due outstanding', async () => {
    // The executive attention loop maps each pastDue → one RETENTION_DUE item (impact = outstanding)
    // 1:1; asserting the source is deterministic and project-scoped, unlike the capped/ranked list.
    const { pastDue } = await loadAllRetention(utcDay())
    const mine = pastDue.find((p) => p.projectId === ids.projectId!)
    expect(mine).toBeTruthy()
    expect(mine!.outstanding).toBe(200) // only tranche 1 (200) is past due; tranche 2 is a year out
  })
})
