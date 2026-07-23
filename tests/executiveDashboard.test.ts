import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PrismaClient } from '@prisma/client'
import { loadForecast } from '@/lib/cash.server'
import { loadProjectCostPerformance } from '@/lib/cost.server'
import { loadExecutiveDashboard } from '@/lib/executive.server'

/**
 * Phase 7 against a real database: due dates drive the outflow forecast, expense outstanding
 * nets matched payments, the AC path ignores dueDate, and the executive assembly + attention
 * list read only from existing derivations.
 */
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(), recordAuditLog: vi.fn() }))

import { getServerSession } from 'next-auth'
import { GET as getExecutive } from '@/app/api/dashboard/executive/route'
import { POST as createExpense } from '@/app/api/expenses/route'
import type { Role } from '@prisma/client'

const prisma = new PrismaClient()
const sfx = `EXE-${Date.now()}`
const ids: Record<string, string> = {}
const utcDay = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) }
const iso = (d: Date) => d.toISOString().slice(0, 10)
const plusDays = (base: Date, n: number) => new Date(base.getTime() + n * 86400000)

function actAs(role: Role) {
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: ids.userId } } as never)
}

beforeAll(async () => {
  const admin = await prisma.user.create({ data: { userCode: `${sfx}-U`, email: `${sfx}@e.local`, passwordHash: 'x', firstName: 'E', lastName: 'X', role: 'ADMIN', status: 'ACTIVE' } })
  ids.userId = admin.id
  const project = await prisma.project.create({ data: { projectCode: `${sfx}-P`, name: `Exe ${sfx}`, status: 'ACTIVE', createdBy: admin.id, currency: 'BHD' } })
  ids.projectId = project.id
  const acc = await prisma.bankAccount.create({ data: { name: `${sfx}-Acc`, currency: 'BHD', openingBalance: 10000, openingDate: new Date('2026-01-01T00:00:00.000Z'), createdBy: admin.id } })
  ids.accountId = acc.id
})

afterAll(async () => {
  if (ids.projectId) {
    await prisma.cashTransaction.deleteMany({ where: { OR: [{ projectId: ids.projectId }, { accountId: ids.accountId }] } })
    await prisma.expense.deleteMany({ where: { projectId: ids.projectId } })
    await prisma.project.deleteMany({ where: { id: ids.projectId } })
  }
  if (ids.accountId) await prisma.bankAccount.deleteMany({ where: { id: ids.accountId } })
  if (ids.userId) await prisma.user.deleteMany({ where: { id: ids.userId } })
  await prisma.$disconnect()
})

describe('Expense.dueDate through the route, and AC is untouched', () => {
  it('accepts dueDate on create and serialises it', async () => {
    actAs('ADMIN')
    const due = iso(plusDays(utcDay(), 20))
    const req = new NextRequest('http://test/api/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: ids.projectId, category: 'SUBCONTRACTOR', description: 'Sub work', amount: 3000, expenseDate: '2026-02-01', dueDate: due }) })
    const res = await createExpense(req)
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.expense.dueDate).toBe(due)
    ids.expenseDated = data.expense.id
  })

  it('a null dueDate is accepted (unscheduled)', async () => {
    actAs('ADMIN')
    const req = new NextRequest('http://test/api/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: ids.projectId, category: 'SUBCONTRACTOR', description: 'Unscheduled sub', amount: 1500, expenseDate: '2026-02-01' }) })
    const res = await createExpense(req)
    expect(res.status).toBe(201)
    expect((await res.json()).expense.dueDate).toBeNull()
  })

  it('the 6B Actual Cost path ignores dueDate entirely', async () => {
    // Both expenses are SUBCONTRACTOR (AC-eligible). AC must reflect amount, not due date.
    const cost = await loadProjectCostPerformance(ids.projectId!)
    expect(cost!.expenses.eligibleTotal).toBe(4500) // 3000 + 1500, regardless of dueDate
  })
})

// Company-wide aggregates can shift while sibling real-DB test files run in parallel, so these
// assert MY contribution as a scoped delta / invariant, never an exact global total.
const dueMonth = () => `${iso(plusDays(utcDay(), 20)).slice(0, 7)}-01`
const outflowIn = (f: Awaited<ReturnType<typeof loadForecast>>, month: string) => f.months.find((m) => m.month === month)?.projectedOutflow ?? 0

describe('outflow forecast from expense payables', () => {
  it('a dated expense with no payments is fully outstanding and buckets by dueDate', async () => {
    const forecast = await loadForecast(6, utcDay())
    expect(outflowIn(forecast, dueMonth())).toBeGreaterThanOrEqual(3000)
    // My unscheduled (null-dueDate) 1500 is present and reported separately, never in a month.
    expect(forecast.unscheduledPayables).toBeGreaterThanOrEqual(1500)
    ids.outflowBefore = String(outflowIn(forecast, dueMonth()))
  })

  it('outstanding nets a matched OUT payment; a fully-paid expense leaves the forecast', async () => {
    // Pay 3000 against the dated expense → its outstanding hits 0 → the due month drops by 3000.
    await prisma.cashTransaction.create({ data: { accountId: ids.accountId!, txnDate: new Date('2026-02-05T00:00:00.000Z'), direction: 'OUT', category: 'SUBCONTRACTOR_PAYMENT', amount: 3000, description: 'pay sub', projectId: ids.projectId!, expenseId: ids.expenseDated!, clearedAt: new Date('2026-02-05T00:00:00.000Z'), createdBy: ids.userId! } })
    const forecast = await loadForecast(6, utcDay())
    const before = Number(ids.outflowBefore)
    expect(before - outflowIn(forecast, dueMonth())).toBe(3000) // exactly my expense left the month
  })
})

describe('executive endpoint', () => {
  it('SUPERVISOR and VIEWER get 403', async () => {
    for (const role of ['SUPERVISOR', 'VIEWER'] as Role[]) {
      // Point the session at a user of that role.
      const u = await prisma.user.create({ data: { userCode: `${sfx}-${role}`, email: `${sfx}-${role}@e.local`, passwordHash: 'x', firstName: 'R', lastName: role, role, status: 'ACTIVE' } })
      vi.mocked(getServerSession).mockResolvedValue({ user: { id: u.id } } as never)
      const res = await getExecutive(new NextRequest('http://test/api/x'))
      expect(res.status).toBe(403)
      await prisma.user.delete({ where: { id: u.id } })
    }
  })

  it('assembles cash headline, running balance and attention list; unscheduled payables surfaced', async () => {
    actAs('ADMIN')
    const res = await getExecutive(new NextRequest('http://test/api/x?months=6'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.forecast).toHaveLength(6)
    // Structural invariants that hold regardless of concurrent company-wide data:
    expect(data.cash.netPosition).toBe(data.forecast[5].runningBalance) // net position = last running balance
    expect(data.cash.unscheduledPayables).toBeGreaterThanOrEqual(1500) // my null-due expense is included
    expect(Array.isArray(data.attention)).toBe(true)
  })

  it('attention list flags the uninvoiced certified valuation', async () => {
    // Create a certified, un-invoiced valuation directly and confirm it appears.
    const v = await prisma.valuation.create({
      data: {
        valuationCode: `${sfx}-VAL`, projectId: ids.projectId!, periodMonth: new Date('2026-02-01T00:00:00.000Z'),
        revisionNumber: 0, status: 'CERTIFIED', certifiedAt: new Date(), invoicedAt: null,
        progressPct: 50, cumulativeMeasured: 5000, cumulativeLumpsum: 0, grossAmount: 5000, previousGross: 0,
        retentionHeld: 0, advanceRecovery: 0, netPayable: 5000, createdBy: ids.userId!,
      },
    })
    const data = await loadExecutiveDashboard(6, utcDay())
    const item = data.attention.find((a) => a.kind === 'UNINVOICED_VALUATION')
    expect(item).toBeTruthy()
    expect(item!.impact).toBe(5000)
    await prisma.valuation.delete({ where: { id: v.id } })
  })
})
