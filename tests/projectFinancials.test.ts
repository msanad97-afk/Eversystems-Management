import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'
import { parsePercent, parseNonNegativeInt, parseCurrency } from '@/lib/validation'

// ── Pure parsers ─────────────────────────────────────────────────────────────

describe('financial-field parsers', () => {
  it('parsePercent: null/empty → null; 0 and 100 accepted; out-of-range and junk → undefined', () => {
    expect(parsePercent(null)).toBeNull()
    expect(parsePercent('')).toBeNull()
    expect(parsePercent(0)).toBe(0)
    expect(parsePercent(100)).toBe(100)
    expect(parsePercent('10.5')).toBe(10.5)
    expect(parsePercent(-1)).toBeUndefined()
    expect(parsePercent(101)).toBeUndefined()
    expect(parsePercent('abc')).toBeUndefined()
    expect(parsePercent(NaN)).toBeUndefined()
  })
  it('parseNonNegativeInt: null/empty → null; integers ≥ 0; rejects negatives and fractions', () => {
    expect(parseNonNegativeInt(null)).toBeNull()
    expect(parseNonNegativeInt('')).toBeNull()
    expect(parseNonNegativeInt(0)).toBe(0)
    expect(parseNonNegativeInt(30)).toBe(30)
    expect(parseNonNegativeInt('45')).toBe(45)
    expect(parseNonNegativeInt(-1)).toBeUndefined()
    expect(parseNonNegativeInt(10.5)).toBeUndefined()
    expect(parseNonNegativeInt('x')).toBeUndefined()
  })
  it('parseCurrency: empty/null → BHD default; trims + uppercases a 3-letter code; rejects the rest', () => {
    expect(parseCurrency(null)).toBe('BHD')
    expect(parseCurrency('')).toBe('BHD')
    expect(parseCurrency(undefined)).toBe('BHD')
    expect(parseCurrency(' usd ')).toBe('USD')
    expect(parseCurrency('bhd')).toBe('BHD')
    expect(parseCurrency('US')).toBeUndefined()
    expect(parseCurrency('DOLLAR')).toBeUndefined()
    expect(parseCurrency('U$D')).toBeUndefined()
    expect(parseCurrency(5)).toBeUndefined()
  })
})

// ── Routes (auth + DB mocked) ────────────────────────────────────────────────

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(), recordAuditLog: vi.fn() }))
vi.mock('@/lib/idgen', () => ({ nextCode: vi.fn().mockResolvedValue('PRJ-2026-009') }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), count: vi.fn().mockResolvedValue(0) },
    project: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    projectMember: { deleteMany: vi.fn(), createMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { writeAuditLog } from '@/lib/audit'
import { PATCH as patchProject } from '@/app/api/projects/[id]/route'
import { POST as createProject } from '@/app/api/projects/route'

function actAs(role: Role) {
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    id: 'u1', email: 'u@e.local', userCode: 'USR-1', firstName: 'U', lastName: 'One',
    role, status: 'ACTIVE', mustChangePassword: false,
  } as never)
}
const patchReq = (body: unknown) =>
  new NextRequest('http://test/api/x', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const postReq = (body: unknown) =>
  new NextRequest('http://test/api/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const params = { params: { id: 'p1' } }

/** An existing project row as PATCH's findUnique returns it (include → all scalars + members). */
const existing = (o: Record<string, unknown> = {}) => ({
  id: 'p1', projectCode: 'PRJ-1', name: 'Demo', location: null, status: 'ACTIVE', startDate: null,
  contractValue: null, budgetCost: null, retentionPct: null, retentionCapPct: null,
  advancePct: null, paymentTermsDays: 45, currency: 'BHD', members: [], ...o,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.user.count).mockResolvedValue(0 as never)
  vi.mocked(prisma.project.findUnique).mockResolvedValue(existing() as never)
  vi.mocked(prisma.project.create).mockResolvedValue({ id: 'p2', projectCode: 'PRJ-2026-009', name: 'New' } as never)
  vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: typeof prisma) => unknown) => fn(prisma)) as never)
})

describe('PATCH — ADMIN-only', () => {
  for (const role of ['VIEWER', 'SUPERVISOR'] as Role[]) {
    it(`${role} gets 403`, async () => {
      actAs(role)
      expect((await patchProject(patchReq({ retentionPct: 10 }), params)).status).toBe(403)
      expect(prisma.project.update).not.toHaveBeenCalled()
    })
  }
})

describe('PATCH — validation bounds (400 with a named field, nothing written)', () => {
  beforeEach(() => actAs('ADMIN'))

  const bad: [string, unknown][] = [
    ['retentionPct', -1], ['retentionPct', 101], ['retentionPct', 'abc'],
    ['retentionCapPct', 100.5], ['advancePct', -0.01],
    ['paymentTermsDays', -1], ['paymentTermsDays', 10.5],
    ['currency', 'US'], ['currency', 'DOLLAR'],
  ]
  for (const [field, value] of bad) {
    it(`rejects ${field} = ${JSON.stringify(value)}`, async () => {
      const res = await patchProject(patchReq({ [field]: value }), params)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toContain(field)
      expect(prisma.project.update).not.toHaveBeenCalled()
    })
  }
})

describe('PATCH — valid financials persist and null clears', () => {
  beforeEach(() => actAs('ADMIN'))

  it('writes retention/cap/advance/terms/currency, uppercasing the code', async () => {
    const res = await patchProject(patchReq({
      retentionPct: 10, retentionCapPct: 5, advancePct: 20, paymentTermsDays: 30, currency: 'usd',
    }), params)
    expect(res.status).toBe(200)
    expect(vi.mocked(prisma.project.update).mock.calls[0]![0].data).toMatchObject({
      retentionPct: 10, retentionCapPct: 5, advancePct: 20, paymentTermsDays: 30, currency: 'USD',
    })
  })

  it('an explicit null clears a percentage and the payment terms', async () => {
    const res = await patchProject(patchReq({ retentionPct: null, paymentTermsDays: null }), params)
    expect(res.status).toBe(200)
    expect(vi.mocked(prisma.project.update).mock.calls[0]![0].data).toMatchObject({ retentionPct: null, paymentTermsDays: null })
  })

  it('does NOT touch fields the payload omits — no accidental blanking', async () => {
    await patchProject(patchReq({ retentionPct: 10 }), params)
    const data = vi.mocked(prisma.project.update).mock.calls[0]![0].data as Record<string, unknown>
    expect(data).toHaveProperty('retentionPct', 10)
    expect(data).not.toHaveProperty('advancePct')
    expect(data).not.toHaveProperty('currency')
    expect(data).not.toHaveProperty('paymentTermsDays')
  })

  it('leaves the 6A contractValue/budgetCost handling intact', async () => {
    const res = await patchProject(patchReq({ contractValue: 1000, budgetCost: '' }), params)
    expect(res.status).toBe(200)
    expect(vi.mocked(prisma.project.update).mock.calls[0]![0].data).toMatchObject({ contractValue: 1000, budgetCost: null })
  })
})

describe('PATCH — audit records old→new for changed financial fields', () => {
  beforeEach(() => actAs('ADMIN'))

  it('carries a financials diff in PROJECT_UPDATED metadata', async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue(existing({ retentionPct: 5, currency: 'BHD' }) as never)
    await patchProject(patchReq({ retentionPct: 10, currency: 'usd' }), params)
    const meta = vi.mocked(writeAuditLog).mock.calls.find((c) => c[0].action === 'PROJECT_UPDATED')![0].metadata as {
      financials: Record<string, { from: unknown; to: unknown }>
    }
    expect(meta.financials.retentionPct).toEqual({ from: 5, to: 10 })
    expect(meta.financials.currency).toEqual({ from: 'BHD', to: 'USD' })
  })

  it('omits the financials key when only non-financial fields change', async () => {
    await patchProject(patchReq({ name: 'Renamed' }), params)
    const meta = vi.mocked(writeAuditLog).mock.calls.find((c) => c[0].action === 'PROJECT_UPDATED')![0].metadata as Record<string, unknown>
    expect(meta).not.toHaveProperty('financials')
  })
})

describe('POST — financials settable at creation', () => {
  beforeEach(() => actAs('ADMIN'))

  it('persists valid financials on create', async () => {
    const res = await createProject(postReq({ name: 'New', retentionPct: 10, advancePct: 20, paymentTermsDays: 30, currency: 'bhd' }))
    expect(res.status).toBe(201)
    expect(vi.mocked(prisma.project.create).mock.calls[0]![0].data).toMatchObject({
      retentionPct: 10, advancePct: 20, paymentTermsDays: 30, currency: 'BHD',
    })
  })

  it('rejects an out-of-range percentage at creation, creating nothing', async () => {
    const res = await createProject(postReq({ name: 'New', retentionPct: 150 }))
    expect(res.status).toBe(400)
    expect(prisma.project.create).not.toHaveBeenCalled()
  })

  it('omits financials entirely when none are supplied (column defaults apply)', async () => {
    await createProject(postReq({ name: 'Bare' }))
    const data = vi.mocked(prisma.project.create).mock.calls[0]![0].data as Record<string, unknown>
    expect(data).not.toHaveProperty('retentionPct')
    expect(data).not.toHaveProperty('currency')
    expect(data).not.toHaveProperty('paymentTermsDays')
  })
})
