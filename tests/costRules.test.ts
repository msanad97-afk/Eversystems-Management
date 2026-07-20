import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { isExpenseEligibleForAC, expenseExclusionReason, AC_ELIGIBLE_CATEGORIES } from '@/lib/cost'

describe('expense AC eligibility (Q5)', () => {
  it('counts direct project costs that do not flow through daily reports', () => {
    for (const c of AC_ELIGIBLE_CATEGORIES) expect(isExpenseEligibleForAC(c, 'p1')).toBe(true)
  })
  it('excludes MATERIALS_DIRECT — reports already own site materials', () => {
    expect(isExpenseEligibleForAC('MATERIALS_DIRECT', 'p1')).toBe(false)
    expect(expenseExclusionReason('MATERIALS_DIRECT', 'p1')).toMatch(/double-count/i)
  })
  it('excludes HEAD_OFFICE_OVERHEAD — company-level, not a project cost', () => {
    expect(isExpenseEligibleForAC('HEAD_OFFICE_OVERHEAD', 'p1')).toBe(false)
    expect(expenseExclusionReason('HEAD_OFFICE_OVERHEAD', 'p1')).toMatch(/company-level/i)
  })
  it('excludes any expense with no project', () => {
    expect(isExpenseEligibleForAC('SUBCONTRACTOR', null)).toBe(false)
    expect(expenseExclusionReason('SUBCONTRACTOR', null)).toMatch(/company overhead/i)
  })
  it('gives no exclusion reason for a counted expense', () => {
    expect(expenseExclusionReason('SUBCONTRACTOR', 'p1')).toBeNull()
  })
})

// ─── access control on the new money surfaces ───
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(), recordAuditLog: vi.fn() }))
vi.mock('@/lib/cost.server', () => ({ loadProjectCostPerformance: vi.fn().mockResolvedValue({ projectId: 'p1' }) }))
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: vi.fn() }, expense: { findMany: vi.fn().mockResolvedValue([]) } } }))

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { GET as getActualCost } from '@/app/api/projects/[id]/actual-cost/route'
import { GET as listExpenses } from '@/app/api/expenses/route'

function actAs(role: Role) {
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    id: 'u1', email: 'u@e.local', userCode: 'USR-1', firstName: 'U', lastName: 'One',
    role, status: 'ACTIVE', mustChangePassword: false,
  } as never)
}
const req = () => new NextRequest('http://test/api/x')

beforeEach(() => vi.clearAllMocks())

describe('6B money surfaces are ADMIN-only', () => {
  it('VIEWER gets 403 on actual-cost and expenses', async () => {
    actAs('VIEWER')
    expect((await getActualCost(req(), { params: { id: 'p1' } })).status).toBe(403)
    expect((await listExpenses(req())).status).toBe(403)
  })
  it('SUPERVISOR gets 403 on both', async () => {
    actAs('SUPERVISOR')
    expect((await getActualCost(req(), { params: { id: 'p1' } })).status).toBe(403)
    expect((await listExpenses(req())).status).toBe(403)
  })
  it('ADMIN gets 200 on both', async () => {
    actAs('ADMIN')
    expect((await getActualCost(req(), { params: { id: 'p1' } })).status).toBe(200)
    expect((await listExpenses(req())).status).toBe(200)
  })
})
