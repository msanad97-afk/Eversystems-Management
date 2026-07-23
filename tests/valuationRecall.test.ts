import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { Role, ValuationStatus } from '@prisma/client'

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(), recordAuditLog: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    valuation: { findFirst: vi.fn(), update: vi.fn() },
  },
}))

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { writeAuditLog } from '@/lib/audit'
import { POST as recall } from '@/app/api/projects/[id]/valuations/[vid]/recall/route'

function actAs(role: Role) {
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    id: 'u1', email: 'u@e.local', userCode: 'USR-1', firstName: 'U', lastName: 'One', role, status: 'ACTIVE', mustChangePassword: false,
  } as never)
}
const req = () => new NextRequest('http://test/api/x', { method: 'POST' })
const params = { params: { id: 'p1', vid: 'v1' } }
const row = (o: { status?: ValuationStatus; supersededAt?: Date | null } = {}) => ({
  id: 'v1', valuationCode: 'VAL-1', status: o.status ?? 'SUBMITTED', supersededAt: o.supersededAt ?? null, periodMonth: new Date('2026-02-01T00:00:00.000Z'),
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.valuation.findFirst).mockResolvedValue(row() as never)
})

describe('valuation recall — SUBMITTED → DRAFT', () => {
  for (const role of ['VIEWER', 'SUPERVISOR'] as Role[]) {
    it(`${role} gets 403`, async () => {
      actAs(role)
      expect((await recall(req(), params)).status).toBe(403)
    })
  }

  it('recalls a SUBMITTED valuation to DRAFT and audits VALUATION_RECALLED', async () => {
    actAs('ADMIN')
    const res = await recall(req(), params)
    expect(res.status).toBe(200)
    expect(vi.mocked(prisma.valuation.update).mock.calls[0]![0].data).toEqual({ status: 'DRAFT' })
    expect(vi.mocked(writeAuditLog).mock.calls[0]![0].action).toBe('VALUATION_RECALLED')
  })

  it('409s on DRAFT, CERTIFIED, and a superseded revision', async () => {
    actAs('ADMIN')
    for (const status of ['DRAFT', 'CERTIFIED'] as ValuationStatus[]) {
      vi.mocked(prisma.valuation.findFirst).mockResolvedValue(row({ status }) as never)
      expect((await recall(req(), params)).status).toBe(409)
    }
    vi.mocked(prisma.valuation.findFirst).mockResolvedValue(row({ status: 'SUBMITTED', supersededAt: new Date() }) as never)
    expect((await recall(req(), params)).status).toBe(409)
    expect(prisma.valuation.update).not.toHaveBeenCalled()
  })

  it('404s when the valuation is not found', async () => {
    actAs('ADMIN')
    vi.mocked(prisma.valuation.findFirst).mockResolvedValue(null as never)
    expect((await recall(req(), params)).status).toBe(404)
  })
})
