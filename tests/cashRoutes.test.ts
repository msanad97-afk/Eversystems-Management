import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(), recordAuditLog: vi.fn() }))
vi.mock('@/lib/cash.server', async (orig) => {
  const actual = await orig<typeof import('@/lib/cash.server')>()
  return {
    ...actual,
    loadCashPosition: vi.fn().mockResolvedValue({ accounts: [], totals: { clearedBalance: 0, pendingIn: 0, pendingOut: 0, projectedBalance: 0 } }),
    loadReceivables: vi.fn().mockResolvedValue([]),
    loadForecast: vi.fn().mockResolvedValue({ months: [], clearedBalance: 0 }),
    loadLedger: vi.fn().mockResolvedValue({ transactions: [], total: 0 }),
    resolveValuationMatch: vi.fn(),
  }
})
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    bankAccount: { findUnique: vi.fn(), create: vi.fn() },
    cashTransaction: { create: vi.fn(), count: vi.fn().mockResolvedValue(0) },
    project: { findUnique: vi.fn() },
    expense: { findUnique: vi.fn() },
    valuation: { findFirst: vi.fn(), update: vi.fn() },
  },
}))

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { resolveValuationMatch, loadForecast } from '@/lib/cash.server'
import { GET as getAccounts, POST as createAccount } from '@/app/api/cash/accounts/route'
import { GET as getPosition } from '@/app/api/cash/position/route'
import { GET as getForecast } from '@/app/api/cash/forecast/route'
import { POST as createTxn } from '@/app/api/cash/transactions/route'
import { POST as invoiceValuation } from '@/app/api/projects/[id]/valuations/[vid]/invoice/route'

function actAs(role: Role) {
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    id: 'u1', email: 'u@e.local', userCode: 'USR-1', firstName: 'U', lastName: 'One',
    role, status: 'ACTIVE', mustChangePassword: false,
  } as never)
}
const req = (url = 'http://test/api/x') => new NextRequest(url)
const jsonReq = (body: unknown) => new NextRequest('http://test/api/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

const account = { id: 'acc1', currency: 'BHD', openingDate: new Date('2026-01-01T00:00:00.000Z') }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.bankAccount.findUnique).mockResolvedValue(account as never)
  vi.mocked(prisma.bankAccount.create).mockResolvedValue({ id: 'acc1', name: 'Main' } as never)
  vi.mocked(prisma.cashTransaction.create).mockResolvedValue({ id: 'txn1' } as never)
  vi.mocked(prisma.project.findUnique).mockResolvedValue({ currency: 'BHD' } as never)
})

describe('cash routes are ADMIN-only', () => {
  for (const role of ['VIEWER', 'SUPERVISOR'] as Role[]) {
    it(`${role} gets 403 everywhere`, async () => {
      actAs(role)
      expect((await getAccounts()).status).toBe(403)
      expect((await createAccount(jsonReq({ name: 'X' }))).status).toBe(403)
      expect((await getPosition()).status).toBe(403)
      expect((await getForecast(req())).status).toBe(403)
      expect((await createTxn(jsonReq({}))).status).toBe(403)
      expect((await invoiceValuation(req(), { params: { id: 'p1', vid: 'v1' } })).status).toBe(403)
    })
  }
  it('ADMIN reaches the read routes', async () => {
    actAs('ADMIN')
    expect((await getPosition()).status).toBe(200)
    expect((await getForecast(req())).status).toBe(200)
  })
})

describe('forecast payload has NO outflow field', () => {
  it('never emits an outflow key', async () => {
    actAs('ADMIN')
    vi.mocked(loadForecast).mockResolvedValue({ months: [{ month: '2026-04-01', projectedInflow: 100 }], clearedBalance: 50 } as never)
    const data = await (await getForecast(req())).json()
    expect(data).toHaveProperty('months')
    expect(JSON.stringify(data)).not.toMatch(/outflow/i)
    expect(data.months[0]).not.toHaveProperty('projectedOutflow')
  })
})

describe('transaction creation rules', () => {
  beforeEach(() => actAs('ADMIN'))

  it('derives direction from category, ignoring a contradictory client value', async () => {
    // VALUATION_RECEIPT is IN; client says OUT — must be ignored. (No valuation match → plain inflow.)
    const res = await createTxn(jsonReq({ accountId: 'acc1', category: 'OTHER_IN', direction: 'OUT', amount: 100, description: 'x', txnDate: '2026-02-01' }))
    expect(res.status).toBe(201)
    expect(vi.mocked(prisma.cashTransaction.create).mock.calls[0]![0].data.direction).toBe('IN')
  })

  it('rejects amount ≤ 0', async () => {
    const res = await createTxn(jsonReq({ accountId: 'acc1', category: 'OTHER_IN', amount: 0, description: 'x', txnDate: '2026-02-01' }))
    expect(res.status).toBe(400)
  })

  it('rejects a date before the account opening date', async () => {
    const res = await createTxn(jsonReq({ accountId: 'acc1', category: 'OTHER_IN', amount: 100, description: 'x', txnDate: '2025-12-31' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/opening date/i)
  })

  it('rejects matching both a valuation and an expense', async () => {
    const res = await createTxn(jsonReq({ accountId: 'acc1', category: 'VALUATION_RECEIPT', amount: 100, description: 'x', txnDate: '2026-02-01', valuationId: 'v1', expenseId: 'e1' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/not both/i)
  })

  it('rejects a valuation match that is not CERTIFIED', async () => {
    vi.mocked(resolveValuationMatch).mockResolvedValue({ ok: false, error: 'A cash receipt can only match a CERTIFIED valuation (this one is DRAFT).' } as never)
    const res = await createTxn(jsonReq({ accountId: 'acc1', category: 'VALUATION_RECEIPT', amount: 100, description: 'x', txnDate: '2026-02-01', valuationId: 'v1' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/CERTIFIED/)
  })

  it('over-payment beyond the period outstanding is rejected with the figure named (flag, not block)', async () => {
    vi.mocked(resolveValuationMatch).mockResolvedValue({ ok: true, projectId: 'p1', ctx: { periodOutstandingBefore: 200, periodNetPayable: 1000 } } as never)
    const res = await createTxn(jsonReq({ accountId: 'acc1', category: 'VALUATION_RECEIPT', amount: 500, description: 'x', txnDate: '2026-02-01', valuationId: 'v1' }))
    expect(res.status).toBe(409)
    const data = await res.json()
    expect(data.requiresOverpayConfirm).toBe(true)
    expect(data.outstanding).toBe(200)
    expect(prisma.cashTransaction.create).not.toHaveBeenCalled()
  })

  it('allowOverpay:true records the over-payment', async () => {
    vi.mocked(resolveValuationMatch).mockResolvedValue({ ok: true, projectId: 'p1', ctx: { periodOutstandingBefore: 200, periodNetPayable: 1000 } } as never)
    const res = await createTxn(jsonReq({ accountId: 'acc1', category: 'VALUATION_RECEIPT', amount: 500, description: 'x', txnDate: '2026-02-01', valuationId: 'v1', allowOverpay: true }))
    expect(res.status).toBe(201)
    expect(vi.mocked(prisma.cashTransaction.create).mock.calls[0]![0].data.projectId).toBe('p1') // taken from the valuation
  })

  it('rejects a currency mismatch between the account and a linked project', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue({ currency: 'USD' } as never)
    const res = await createTxn(jsonReq({ accountId: 'acc1', category: 'OTHER_OUT', amount: 100, description: 'x', txnDate: '2026-02-01', projectId: 'p1' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/currency mismatch/i)
  })
})

describe('invoice route never touches status', () => {
  beforeEach(() => actAs('ADMIN'))

  it('sets invoicedAt on a CERTIFIED valuation and audits VALUATION_INVOICED — status not in the update', async () => {
    vi.mocked(prisma.valuation.findFirst).mockResolvedValue({ id: 'v1', valuationCode: 'VAL-1', status: 'CERTIFIED', invoicedAt: null, periodMonth: new Date('2026-02-01T00:00:00.000Z') } as never)
    const res = await invoiceValuation(jsonReq({ invoiced: true }), { params: { id: 'p1', vid: 'v1' } })
    expect(res.status).toBe(200)
    const data = vi.mocked(prisma.valuation.update).mock.calls[0]![0].data as Record<string, unknown>
    expect(data).toHaveProperty('invoicedAt')
    expect(data).not.toHaveProperty('status') // §6E.1 — never advance the certification machine
  })

  it('409s on a non-CERTIFIED valuation', async () => {
    vi.mocked(prisma.valuation.findFirst).mockResolvedValue({ id: 'v1', valuationCode: 'VAL-1', status: 'DRAFT', invoicedAt: null, periodMonth: new Date() } as never)
    expect((await invoiceValuation(jsonReq({ invoiced: true }), { params: { id: 'p1', vid: 'v1' } })).status).toBe(409)
  })
})
