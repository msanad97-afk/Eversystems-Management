import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'

// Real route handlers; auth source + DB mocked so we assert the guard, not the payload.
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(), recordAuditLog: vi.fn() }))
vi.mock('@/lib/budget.server', () => ({ loadProjectBudget: vi.fn().mockResolvedValue({ projectId: 'p1' }) }))
vi.mock('@/lib/actuals.server', () => ({ loadBudgetVsActual: vi.fn().mockResolvedValue({ projectId: 'p1' }) }))
vi.mock('@/lib/money.server', () => ({ loadProjectMoney: vi.fn().mockResolvedValue({ projectId: 'p1' }) }))
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: vi.fn() } } }))

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { GET as getBudget } from '@/app/api/projects/[id]/budget/route'
import { GET as getBudgetVsActual } from '@/app/api/projects/[id]/budget-vs-actual/route'
import { GET as getCostBudget } from '@/app/api/projects/[id]/cost-budget/route'

function actAs(role: Role) {
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    id: 'u1', email: 'u@e.local', userCode: 'USR-1', firstName: 'U', lastName: 'One',
    role, status: 'ACTIVE', mustChangePassword: false,
  } as never)
}
const req = () => new NextRequest('http://test/api/x')
const params = { params: { id: 'p1' } }

beforeEach(() => vi.clearAllMocks())

describe('Phase 6A: money endpoints are ADMIN-only (closes the C1/C2 VIEWER leak)', () => {
  it('VIEWER gets 403 on /budget (carries lumpsum BHD)', async () => {
    actAs('VIEWER')
    expect((await getBudget(req(), params)).status).toBe(403)
  })
  it('VIEWER gets 403 on /budget-vs-actual (carries budget/earned BHD)', async () => {
    actAs('VIEWER')
    expect((await getBudgetVsActual(req(), params)).status).toBe(403)
  })
  it('VIEWER gets 403 on /cost-budget', async () => {
    actAs('VIEWER')
    expect((await getCostBudget(req(), params)).status).toBe(403)
  })
  it('SUPERVISOR is also blocked from all three', async () => {
    actAs('SUPERVISOR')
    expect((await getBudget(req(), params)).status).toBe(403)
    expect((await getBudgetVsActual(req(), params)).status).toBe(403)
    expect((await getCostBudget(req(), params)).status).toBe(403)
  })
  it('ADMIN still gets 200 on all three', async () => {
    actAs('ADMIN')
    expect((await getBudget(req(), params)).status).toBe(200)
    expect((await getBudgetVsActual(req(), params)).status).toBe(200)
    expect((await getCostBudget(req(), params)).status).toBe(200)
  })
})
