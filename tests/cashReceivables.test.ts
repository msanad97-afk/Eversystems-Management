import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { computeValuation, computationToHeader, computationToLines, loadCertifiedRevisionsByPeriod } from '@/lib/valuation.server'
import { loadReceivables, loadCashPosition, loadAdvanceBlock } from '@/lib/cash.server'

/**
 * Phase 6E correctness core, against a real database. The revision trap, the §6E.1
 * status-never-written invariant, receipts following revisions, the sequential-period guard,
 * and balance reconciliation are all things a mock cannot prove.
 */
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(), recordAuditLog: vi.fn() }))

import { getServerSession } from 'next-auth'
import { POST as createValuation } from '@/app/api/projects/[id]/valuations/route'

const prisma = new PrismaClient()
const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const LABOUR = `CrLabour-${sfx}`
const ids: Record<string, string> = {}
const utcDay = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) }

async function approvedReport(date: string, code: string, qty: number) {
  return prisma.dailyReport.create({
    data: {
      reportCode: code, projectId: ids.projectId!, authorId: ids.userId!,
      reportDate: new Date(`${date}T00:00:00.000Z`), status: 'APPROVED',
      activities: { create: [{ activityId: ids.activity!, subActivities: { create: [{ subActivityId: ids.sub!, quantityDone: qty }] } }] },
    },
  })
}

/** Certify a month exactly as the certify route does: compute → create DRAFT → freeze. */
async function certifyMonth(periodMonth: string, code: string, revisionNumber = 0) {
  const c = (await computeValuation(ids.projectId!, periodMonth))!
  const v = await prisma.valuation.create({
    data: {
      valuationCode: code, projectId: ids.projectId!, periodMonth: new Date(`${periodMonth}T00:00:00.000Z`),
      revisionNumber, status: 'CERTIFIED', certifiedAt: new Date(),
      expectedReceipt: new Date(`${periodMonth}T00:00:00.000Z`), // set explicitly for ageing tests
      contractValueAtCert: c.contractValue, createdBy: ids.userId!,
      ...computationToHeader(c), lines: { create: computationToLines(c) },
    },
  })
  return { id: v.id, computed: c }
}

async function receipt(valuationId: string, amount: number) {
  return prisma.cashTransaction.create({
    data: {
      accountId: ids.accountId!, txnDate: new Date('2026-06-01T00:00:00.000Z'), direction: 'IN',
      category: 'VALUATION_RECEIPT', amount, description: 'receipt', projectId: ids.projectId!,
      valuationId, clearedAt: new Date('2026-06-01T00:00:00.000Z'), createdBy: ids.userId!,
    },
  })
}

beforeAll(async () => {
  const labour = await prisma.laborCategory.create({ data: { name: LABOUR, hourlyRate: 1 } })
  const admin = await prisma.user.create({ data: { userCode: `CR-U-${sfx}`, email: `cr_${sfx}@e.local`, passwordHash: 'x', firstName: 'C', lastName: 'R', role: 'ADMIN', status: 'ACTIVE' } })
  ids.userId = admin.id
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: admin.id } } as never)

  // No retention / advance → netPayable = grossThisPeriod, so the arithmetic is easy to read.
  const project = await prisma.project.create({ data: { projectCode: `CR-P-${sfx}`, name: `Cash ${sfx}`, status: 'ACTIVE', createdBy: admin.id, paymentTermsDays: 30, currency: 'BHD' } })
  ids.projectId = project.id

  const asset = await prisma.asset.create({ data: { projectId: project.id, name: 'Block A' } })
  const activity = await prisma.activity.create({
    data: {
      assetId: asset.id, name: 'Blockwork', type: 'MEASURED', unit: 'm2', boqQuantity: 100, billRate: 10,
      subActivities: { create: [{ name: '__implicit__', type: 'MEASURED', isImplicit: true, manpowerBudget: { create: [{ laborCategoryId: labour.id, hoursPerUnit: 1, costRateAtPlacement: 1 }] } }] },
    },
    include: { subActivities: true },
  })
  ids.activity = activity.id
  ids.sub = activity.subActivities[0]!.id

  const acc = await prisma.bankAccount.create({ data: { name: `CR-Acc-${sfx}`, currency: 'BHD', openingBalance: 1000, openingDate: new Date('2026-01-01T00:00:00.000Z'), createdBy: admin.id } })
  ids.accountId = acc.id

  // Cumulative progress: Jan 20 m², Feb 50, Mar 80 (billRate 10 → 200 / 500 / 800 cumulative).
  await approvedReport('2026-01-20', `CR-${sfx}-R1`, 20)
  await approvedReport('2026-02-20', `CR-${sfx}-R2`, 30) // cumulative 50
  await approvedReport('2026-03-20', `CR-${sfx}-R3`, 30) // cumulative 80
})

afterAll(async () => {
  if (ids.projectId) {
    await prisma.cashTransaction.deleteMany({ where: { projectId: ids.projectId } })
    await prisma.dailyReport.deleteMany({ where: { projectId: ids.projectId } })
    await prisma.valuation.deleteMany({ where: { projectId: ids.projectId } })
    await prisma.project.deleteMany({ where: { id: ids.projectId } })
  }
  if (ids.accountId) await prisma.cashTransaction.deleteMany({ where: { accountId: ids.accountId } })
  if (ids.accountId) await prisma.bankAccount.deleteMany({ where: { id: ids.accountId } })
  await prisma.laborCategory.deleteMany({ where: { name: LABOUR } })
  if (ids.userId) await prisma.user.deleteMany({ where: { id: ids.userId } })
  await prisma.$disconnect()
})

describe('§6E.1 — Valuation.status is never advanced, so certified periods stay found', () => {
  it('after invoicing + fully paying month 1, month 3’s previousGross is still month 2’s cumulative', async () => {
    const jan = await certifyMonth('2026-01-01', `VAL-CR-${sfx}-01`)
    const feb = await certifyMonth('2026-02-01', `VAL-CR-${sfx}-02`)
    ids.janV0 = jan.id
    ids.febV0 = feb.id
    expect(jan.computed.cumulativeGross).toBe(200)
    expect(feb.computed.cumulativeGross).toBe(500)

    // Invoice + fully pay January — the payment side, which must NOT change status.
    await prisma.valuation.update({ where: { id: jan.id }, data: { invoicedAt: new Date() } })
    await receipt(jan.id, 200)

    // The §6E.1 trap: month 3 must bill only March, i.e. previousGross = February's cumulative.
    const mar = await computeValuation(ids.projectId!, '2026-03-01')
    expect(mar!.previousGross).toBe(500) // NOT 0 — January being paid did not drop it
    expect(mar!.cumulativeGross).toBe(800)
    expect(mar!.grossThisPeriod).toBe(300)

    // Both certified periods are still visible to the shared helper.
    const certified = await loadCertifiedRevisionsByPeriod(prisma, { projectId: ids.projectId! })
    expect(certified.map((c) => c.periodMonth.toISOString().slice(0, 10))).toEqual(['2026-01-01', '2026-02-01'])

    // And status was never written to INVOICED/PAID.
    const janRow = await prisma.valuation.findUnique({ where: { id: jan.id }, select: { status: true, invoicedAt: true } })
    expect(janRow!.status).toBe('CERTIFIED')
    expect(janRow!.invoicedAt).not.toBeNull()
  })
})

describe('receivables & payment state', () => {
  it('January is PAID (receipt = netPayable) and drops out of outstanding rows', async () => {
    const rows = await loadReceivables({ projectId: ids.projectId!, today: utcDay() })
    const jan = rows.find((r) => r.periodMonth === '2026-01-01')
    // Fully paid → outstanding 0 and no residual receipt mismatch → not listed.
    expect(jan).toBeUndefined()
    const feb = rows.find((r) => r.periodMonth === '2026-02-01')!
    expect(feb.receiptsTotal).toBe(0)
    expect(feb.outstanding).toBe(feb.netPayable)
    expect(feb.paymentState).toBe('UNINVOICED')
  })

  it('a partial receipt yields PART_PAID with the right outstanding', async () => {
    await receipt(ids.febV0!, 100) // Feb net is 300
    const rows = await loadReceivables({ projectId: ids.projectId!, today: utcDay() })
    const feb = rows.find((r) => r.periodMonth === '2026-02-01')!
    expect(feb.receiptsTotal).toBe(100)
    expect(feb.outstanding).toBe(feb.netPayable - 100)
    expect(feb.paymentState).toBe('PART_PAID')
  })
})

describe('the revision trap — receivables use the CURRENT certified revision per period', () => {
  it('a re-issued month appears ONCE at the live revision’s net payable, never summed', async () => {
    // Supersede Feb rev0 and certify rev1 (recomputed identically here — same progress).
    await prisma.valuation.update({ where: { id: ids.febV0! }, data: { supersededAt: new Date() } })
    const feb1 = await certifyMonth('2026-02-01', `VAL-CR-${sfx}-02-r1`, 1)
    ids.febV1 = feb1.id

    const certified = await loadCertifiedRevisionsByPeriod(prisma, { projectId: ids.projectId! })
    const febRows = certified.filter((c) => c.periodMonth.toISOString().slice(0, 10) === '2026-02-01')
    expect(febRows).toHaveLength(1) // one row for the period, not one per revision
    expect(febRows[0]!.revisionNumber).toBe(1)

    const rows = await loadReceivables({ projectId: ids.projectId!, today: utcDay() })
    const feb = rows.filter((r) => r.periodMonth === '2026-02-01')
    expect(feb).toHaveLength(1)
    expect(feb[0]!.valuationId).toBe(feb1.id) // the live revision
    expect(feb[0]!.netPayable).toBe(300) // the live net, not 300 + 300
  })

  it('a receipt paid against the now-superseded rev0 still counts toward the period total', async () => {
    // The 100 receipt earlier was matched to febV0, which is now superseded.
    const rows = await loadReceivables({ projectId: ids.projectId!, today: utcDay() })
    const feb = rows.find((r) => r.periodMonth === '2026-02-01')!
    expect(feb.receiptsTotal).toBe(100) // still counted, across revisions of the period
    expect(feb.outstanding).toBe(200) // live net 300 − 100 paid against rev0
  })
})

describe('the sequential-period guard (6E.9)', () => {
  it('rejects creating a valuation earlier than the latest certified period', async () => {
    // Latest certified period is March? No — we certified Jan and Feb (+ Feb rev1). Certify March first.
    await certifyMonth('2026-03-01', `VAL-CR-${sfx}-03`)
    const req = new NextRequest('http://test/api/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ periodMonth: '2026-01-01' }) })
    const res = await createValuation(req, { params: { id: ids.projectId! } })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/sequential|re-issue/i)
  })
})

describe('balances reconcile on a real account', () => {
  it('clearedBalance = opening + Σ cleared; projected includes pending', async () => {
    // Existing receipts (200 + 100) are cleared IN. Add one pending OUT.
    await prisma.cashTransaction.create({
      data: { accountId: ids.accountId!, txnDate: new Date('2026-06-05T00:00:00.000Z'), direction: 'OUT', category: 'SUPPLIER_PAYMENT', amount: 50, description: 'pending pay', projectId: ids.projectId!, clearedAt: null, createdBy: ids.userId! },
    })
    const position = await loadCashPosition()
    const acc = position.accounts.find((a) => a.id === ids.accountId!)!
    expect(acc.clearedBalance).toBe(1300) // 1000 opening + 300 cleared receipts
    expect(acc.pendingOut).toBe(50)
    expect(acc.projectedBalance).toBe(1250) // 1300 − 50 pending
  })
})

describe('advance block is null when advancePct is null', () => {
  it('returns null so the UI hides it', async () => {
    expect(await loadAdvanceBlock(ids.projectId!)).toBeNull()
  })
})
