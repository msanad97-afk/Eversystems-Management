import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { Role, ValuationStatus } from '@prisma/client'

// Real handlers; auth + data mocked so we assert the guards, the state machine and the
// write path — not payload arithmetic, which tests/valuation.test.ts covers exhaustively.
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(), recordAuditLog: vi.fn() }))
vi.mock('@/lib/idgen', () => ({ nextCode: vi.fn().mockResolvedValue('VAL-2026-0001') }))
vi.mock('@/lib/valuation.server', () => ({
  computeValuation: vi.fn(),
  computationToHeader: vi.fn().mockReturnValue({ grossAmount: 1000 }),
  computationToLines: vi.fn().mockReturnValue([]),
  listValuations: vi.fn().mockResolvedValue([]),
  loadValuation: vi.fn().mockResolvedValue({ id: 'v1', periodMonth: '2026-03-01' }),
  loadRevisionHistory: vi.fn().mockResolvedValue([]),
  certifyBlockers: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    project: { findUnique: vi.fn() },
    valuation: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    valuationLine: { deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { writeAuditLog } from '@/lib/audit'
import { computeValuation, certifyBlockers } from '@/lib/valuation.server'
import { GET as listValuationsRoute, POST as createValuation } from '@/app/api/projects/[id]/valuations/route'
import { GET as getValuation, PATCH as patchValuation } from '@/app/api/projects/[id]/valuations/[vid]/route'
import { POST as submitValuation } from '@/app/api/projects/[id]/valuations/[vid]/submit/route'
import { POST as certifyValuation } from '@/app/api/projects/[id]/valuations/[vid]/certify/route'
import { POST as reissueValuation } from '@/app/api/projects/[id]/valuations/[vid]/reissue/route'

function actAs(role: Role) {
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    id: 'u1', email: 'u@e.local', userCode: 'USR-1', firstName: 'U', lastName: 'One',
    role, status: 'ACTIVE', mustChangePassword: false,
  } as never)
}

const req = () => new NextRequest('http://test/api/x')
const bodyReq = (body: unknown, method: 'POST' | 'PATCH' = 'POST') =>
  new NextRequest('http://test/api/x', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const params = { params: { id: 'p1' } }
const vParams = { params: { id: 'p1', vid: 'v1' } }

/** A stored valuation row as the routes select it. */
const row = (o: { status?: ValuationStatus; supersededAt?: Date | null; revisionNumber?: number } = {}) => ({
  id: 'v1',
  valuationCode: 'VAL-2026-0001',
  status: o.status ?? 'DRAFT',
  periodMonth: new Date('2026-03-01T00:00:00.000Z'),
  revisionNumber: o.revisionNumber ?? 0,
  supersededAt: o.supersededAt ?? null,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.project.findUnique).mockResolvedValue({
    id: 'p1', projectCode: 'PRJ-1', retentionPct: null, retentionCapPct: null, advancePct: null, paymentTermsDays: 45,
  } as never)
  vi.mocked(prisma.valuation.findFirst).mockResolvedValue(null as never)
  vi.mocked(prisma.valuation.create).mockResolvedValue({ id: 'v2', valuationCode: 'VAL-2026-0001', revisionNumber: 1 } as never)
  vi.mocked(prisma.valuation.updateMany).mockResolvedValue({ count: 1 } as never)
  vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: typeof prisma) => unknown) => fn(prisma)) as never)
  vi.mocked(certifyBlockers).mockResolvedValue([])
  vi.mocked(computeValuation).mockResolvedValue({
    periodMonth: '2026-03-01', cumulativeGross: 1000, grossThisPeriod: 1000, netThisPeriod: 900,
    retentionHeld: 100, advanceRecovery: 0, contractValue: 5000,
  } as never)
})

describe('6D routes are ADMIN-only (supervisors never see money)', () => {
  for (const role of ['VIEWER', 'SUPERVISOR'] as Role[]) {
    it(`${role} gets 403 on every valuation route`, async () => {
      actAs(role)
      expect((await listValuationsRoute(req(), params)).status).toBe(403)
      expect((await createValuation(bodyReq({ periodMonth: '2026-03-01' }), params)).status).toBe(403)
      expect((await getValuation(req(), vParams)).status).toBe(403)
      expect((await patchValuation(bodyReq({}, 'PATCH'), vParams)).status).toBe(403)
      expect((await submitValuation(req(), vParams)).status).toBe(403)
      expect((await certifyValuation(req(), vParams)).status).toBe(403)
      expect((await reissueValuation(req(), vParams)).status).toBe(403)
    })
  }

  it('ADMIN gets 200 on the read routes', async () => {
    actAs('ADMIN')
    expect((await listValuationsRoute(req(), params)).status).toBe(200)
    expect((await getValuation(req(), vParams)).status).toBe(200)
  })
})

describe('creating a draft', () => {
  beforeEach(() => actAs('ADMIN'))

  it('rejects a period that is not the first of a month', async () => {
    const res = await createValuation(bodyReq({ periodMonth: '2026-03-15' }), params)
    expect(res.status).toBe(400)
    expect(prisma.valuation.create).not.toHaveBeenCalled()
  })

  it('rejects a month that already has a LIVE revision', async () => {
    vi.mocked(prisma.valuation.findFirst).mockResolvedValue({ id: 'vX', valuationCode: 'VAL-2026-0009' } as never)
    const res = await createValuation(bodyReq({ periodMonth: '2026-03-01' }), params)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/already has a live certificate/i)
    expect(prisma.valuation.create).not.toHaveBeenCalled()
  })

  it('creates revision 0 in a transaction and audits VALUATION_CREATED', async () => {
    const res = await createValuation(bodyReq({ periodMonth: '2026-03-01' }), params)
    expect(res.status).toBe(201)
    expect(prisma.$transaction).toHaveBeenCalled()
    expect(vi.mocked(prisma.valuation.create).mock.calls[0]![0].data).toMatchObject({ revisionNumber: 0, status: 'DRAFT' })
    expect(vi.mocked(writeAuditLog).mock.calls[0]![0].action).toBe('VALUATION_CREATED')
  })
})

describe('status guards — the state machine cannot be skipped', () => {
  beforeEach(() => actAs('ADMIN'))

  it('PATCH 409s on anything but a DRAFT', async () => {
    vi.mocked(prisma.valuation.findFirst).mockResolvedValue(row({ status: 'CERTIFIED' }) as never)
    const res = await patchValuation(bodyReq({}, 'PATCH'), vParams)
    expect(res.status).toBe(409)
    expect(prisma.valuation.update).not.toHaveBeenCalled()
  })

  it('submit 409s on anything but a DRAFT', async () => {
    vi.mocked(prisma.valuation.findFirst).mockResolvedValue(row({ status: 'CERTIFIED' }) as never)
    expect((await submitValuation(req(), vParams)).status).toBe(409)
  })

  it('submit moves DRAFT → SUBMITTED and audits it', async () => {
    vi.mocked(prisma.valuation.findFirst).mockResolvedValue(row({ status: 'DRAFT' }) as never)
    const res = await submitValuation(req(), vParams)
    expect(res.status).toBe(200)
    expect(vi.mocked(prisma.valuation.update).mock.calls[0]![0].data).toMatchObject({ status: 'SUBMITTED' })
    expect(vi.mocked(writeAuditLog).mock.calls[0]![0].action).toBe('VALUATION_SUBMITTED')
  })

  it('certify 409s on an already-CERTIFIED revision — there is no re-certify', async () => {
    vi.mocked(prisma.valuation.findFirst).mockResolvedValue(row({ status: 'CERTIFIED' }) as never)
    expect((await certifyValuation(req(), vParams)).status).toBe(409)
  })

  it('certify 409s on a superseded revision', async () => {
    vi.mocked(prisma.valuation.findFirst).mockResolvedValue(row({ status: 'SUBMITTED', supersededAt: new Date() }) as never)
    const res = await certifyValuation(req(), vParams)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/superseded/i)
  })

  it('reissue 409s on a DRAFT — only an approved certificate is re-issued', async () => {
    vi.mocked(prisma.valuation.findFirst).mockResolvedValue(row({ status: 'DRAFT' }) as never)
    const res = await reissueValuation(req(), vParams)
    expect(res.status).toBe(409)
    expect(prisma.valuation.create).not.toHaveBeenCalled()
  })
})

describe('certification gate — hard block, with the list', () => {
  beforeEach(() => actAs('ADMIN'))

  it('blocks certify and names the offending scope, writing nothing', async () => {
    vi.mocked(prisma.valuation.findFirst).mockResolvedValue(row({ status: 'SUBMITTED' }) as never)
    vi.mocked(certifyBlockers).mockResolvedValue([
      { kind: 'ACTIVITY_BILL', name: 'Blockwork', detail: 'no bill rate' },
      { kind: 'ASSET_LUMPSUM_REVENUE', name: 'Block A', detail: 'no lump-sum revenue' },
    ])
    const res = await certifyValuation(req(), vParams)
    expect(res.status).toBe(409)
    const data = await res.json()
    expect(data.blockers).toHaveLength(2)
    expect(data.blockers[0].name).toBe('Blockwork')
    expect(prisma.valuation.update).not.toHaveBeenCalled()
    expect(writeAuditLog).not.toHaveBeenCalled()
  })

  it('drafting is NOT gated — a draft is created even with blockers', async () => {
    vi.mocked(certifyBlockers).mockResolvedValue([{ kind: 'ACTIVITY_BILL', name: 'Blockwork', detail: 'no bill rate' }])
    const res = await createValuation(bodyReq({ periodMonth: '2026-03-01' }), params)
    expect(res.status).toBe(201)
  })

  it('a clear gate certifies: freezes the parameter snapshots and audits it', async () => {
    vi.mocked(prisma.valuation.findFirst).mockResolvedValue(row({ status: 'SUBMITTED' }) as never)
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      id: 'p1', projectCode: 'PRJ-1', retentionPct: 10, retentionCapPct: 5, advancePct: 20, paymentTermsDays: 45,
    } as never)
    const res = await certifyValuation(req(), vParams)
    expect(res.status).toBe(200)
    const data = vi.mocked(prisma.valuation.update).mock.calls[0]![0].data as Record<string, unknown>
    expect(data.status).toBe('CERTIFIED')
    expect(data.certifiedAt).toBeInstanceOf(Date)
    expect(data.contractValueAtCert).toBe(5000)
    expect(data.retentionPctAtCert).toBe(10)
    expect(data.advancePctAtCert).toBe(20)
    expect(data.expectedReceipt).toBeInstanceOf(Date) // certifiedAt + paymentTermsDays
    expect(vi.mocked(writeAuditLog).mock.calls[0]![0].action).toBe('VALUATION_CERTIFIED')
  })
})

describe('re-issue', () => {
  beforeEach(() => {
    actAs('ADMIN')
    vi.mocked(prisma.valuation.findFirst).mockResolvedValue(row({ status: 'CERTIFIED', revisionNumber: 0 }) as never)
  })

  it('supersedes the live revision and creates the next one as a DRAFT, in one transaction', async () => {
    const res = await reissueValuation(req(), vParams)
    expect(res.status).toBe(201)
    expect(prisma.$transaction).toHaveBeenCalled()
    // The old revision is superseded, never mutated in substance.
    const supersede = vi.mocked(prisma.valuation.updateMany).mock.calls[0]![0]
    expect(supersede.where).toMatchObject({ id: 'v1', supersededAt: null })
    expect(supersede.data.supersededAt).toBeInstanceOf(Date)
    // The new revision is a fresh draft, numbered up, code suffixed.
    const created = vi.mocked(prisma.valuation.create).mock.calls[0]![0].data as Record<string, unknown>
    expect(created.revisionNumber).toBe(1)
    expect(created.status).toBe('DRAFT')
    expect(created.valuationCode).toBe('VAL-2026-0001-r1')
    expect(vi.mocked(writeAuditLog).mock.calls[0]![0].action).toBe('VALUATION_REISSUED')
  })

  it('409s rather than creating a second live revision when another re-issue won the race', async () => {
    vi.mocked(prisma.valuation.updateMany).mockResolvedValue({ count: 0 } as never)
    const res = await reissueValuation(req(), vParams)
    expect(res.status).toBe(409)
    expect(writeAuditLog).not.toHaveBeenCalled()
  })

  it('409s on an already-superseded revision', async () => {
    vi.mocked(prisma.valuation.findFirst).mockResolvedValue(row({ status: 'CERTIFIED', supersededAt: new Date() }) as never)
    expect((await reissueValuation(req(), vParams)).status).toBe(409)
  })
})
