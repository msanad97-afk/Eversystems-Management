import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'

// Real handlers; auth + data mocked so we assert the guard and the write path, not payloads.
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(), recordAuditLog: vi.fn() }))
vi.mock('@/lib/evm.server', () => ({
  loadProjectEvm: vi.fn().mockResolvedValue({ projectId: 'p1' }),
  loadActivityEvm: vi.fn().mockResolvedValue({ projectId: 'p1' }),
  loadPortfolioEvm: vi.fn().mockResolvedValue({ asOf: '2026-01-01', projects: [], totals: {} }),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    project: { findUnique: vi.fn().mockResolvedValue({ id: 'p1', projectCode: 'PRJ-1' }) },
    baselinePeriod: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn(), createMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { writeAuditLog } from '@/lib/audit'
import { GET as getEvm } from '@/app/api/projects/[id]/evm/route'
import { GET as getBaseline, PUT as putBaseline } from '@/app/api/projects/[id]/baseline/route'
import { GET as getPortfolio } from '@/app/api/portfolio/evm/route'

function actAs(role: Role) {
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    id: 'u1', email: 'u@e.local', userCode: 'USR-1', firstName: 'U', lastName: 'One',
    role, status: 'ACTIVE', mustChangePassword: false,
  } as never)
}
const req = (url = 'http://test/api/x') => new NextRequest(url)
const putReq = (body: unknown) =>
  new NextRequest('http://test/api/x', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const params = { params: { id: 'p1' } }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.project.findUnique).mockResolvedValue({ id: 'p1', projectCode: 'PRJ-1' } as never)
  vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: typeof prisma) => unknown) => fn(prisma)) as never)
})

describe('6C routes are ADMIN-only (supervisors never see money)', () => {
  for (const role of ['VIEWER', 'SUPERVISOR'] as Role[]) {
    it(`${role} gets 403 on evm, baseline GET/PUT and portfolio`, async () => {
      actAs(role)
      expect((await getEvm(req(), params)).status).toBe(403)
      expect((await getBaseline(req(), params)).status).toBe(403)
      expect((await putBaseline(putReq({ baseline: [] }), params)).status).toBe(403)
      expect((await getPortfolio(req())).status).toBe(403)
    })
  }
  it('ADMIN gets 200 on the read routes', async () => {
    actAs('ADMIN')
    expect((await getEvm(req(), params)).status).toBe(200)
    expect((await getBaseline(req(), params)).status).toBe(200)
    expect((await getPortfolio(req())).status).toBe(200)
  })
})

describe('baseline PUT validation — rejects before writing anything', () => {
  beforeEach(() => actAs('ADMIN'))

  it('rejects a non-monotonic curve and never writes', async () => {
    const res = await putBaseline(putReq({ baseline: [
      { periodMonth: '2026-01-01', cumPlannedPct: 60 },
      { periodMonth: '2026-02-01', cumPlannedPct: 40 },
    ] }), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/cannot go down/i)
    expect(prisma.baselinePeriod.deleteMany).not.toHaveBeenCalled()
    expect(prisma.baselinePeriod.createMany).not.toHaveBeenCalled()
  })

  it('rejects a month gap and never writes', async () => {
    const res = await putBaseline(putReq({ baseline: [
      { periodMonth: '2026-01-01', cumPlannedPct: 30 },
      { periodMonth: '2026-03-01', cumPlannedPct: 100 },
    ] }), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/contiguous/i)
    expect(prisma.baselinePeriod.createMany).not.toHaveBeenCalled()
  })

  it('rejects a curve that does not end at 100%', async () => {
    const res = await putBaseline(putReq({ baseline: [{ periodMonth: '2026-01-01', cumPlannedPct: 90 }] }), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/100%/)
  })

  it('accepts a valid curve, writes atomically and audits BASELINE_UPDATED', async () => {
    const res = await putBaseline(putReq({ baseline: [
      { periodMonth: '2026-01-01', cumPlannedPct: 30 },
      { periodMonth: '2026-02-01', cumPlannedPct: 100 },
    ] }), params)
    expect(res.status).toBe(200)
    expect(prisma.$transaction).toHaveBeenCalled()
    expect(prisma.baselinePeriod.deleteMany).toHaveBeenCalled() // whole-curve replacement
    expect(prisma.baselinePeriod.createMany).toHaveBeenCalled()
    expect(vi.mocked(writeAuditLog).mock.calls[0]![0].action).toBe('BASELINE_UPDATED')
  })

  it('an empty curve clears the baseline (valid)', async () => {
    const res = await putBaseline(putReq({ baseline: [] }), params)
    expect(res.status).toBe(200)
    expect(prisma.baselinePeriod.deleteMany).toHaveBeenCalled()
    expect(prisma.baselinePeriod.createMany).not.toHaveBeenCalled()
  })
})
