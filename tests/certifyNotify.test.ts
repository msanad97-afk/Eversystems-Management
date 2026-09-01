import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocked prisma + valuation math: assert the certify ROUTE fires the VALUATION_CERTIFIED notice
// AFTER the freeze commits, and that a notification failure never rolls the certification back.
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(), recordAuditLog: vi.fn() }))
vi.mock('@/lib/valuation.server', () => ({
  computeValuation: vi.fn(async () => ({ contractValue: 5000, cumulativeGross: 1000, grossThisPeriod: 1000, retentionHeld: 50, advanceRecovery: 0, netThisPeriod: 900 })),
  computationToHeader: vi.fn().mockReturnValue({ grossAmount: 1000, netPayable: 900 }),
  computationToLines: vi.fn().mockReturnValue([]),
  certifyBlockers: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/email/send.server', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/email/send.server')>()
  return { ...actual, sendRecordedEmail: vi.fn(async () => ({ ok: false, emailSendId: null, error: 'SMTP 421 — down' })) }
})
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    project: { findUnique: vi.fn() },
    valuation: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    valuationLine: { deleteMany: vi.fn().mockResolvedValue({}) },
    notificationRecipient: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))

import { getServerSession } from 'next-auth'
import { sendRecordedEmail } from '@/lib/email/send.server'
import { prisma } from '@/lib/prisma'
import { POST as certify } from '@/app/api/projects/[id]/valuations/[vid]/certify/route'

const vParams = { params: { id: 'p1', vid: 'v1' } }
const req = () => new Request('http://test/x', { method: 'POST' }) as never

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'admin1' } } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'admin1', email: 'a@e.local', userCode: 'U1', firstName: 'A', lastName: 'D', role: 'ADMIN', status: 'ACTIVE', mustChangePassword: false } as never)
  vi.mocked(prisma.valuation.findFirst).mockResolvedValue({ id: 'v1', valuationCode: 'VAL-2026-0001', status: 'DRAFT', periodMonth: new Date('2026-06-01T00:00:00.000Z'), supersededAt: null } as never)
  vi.mocked(prisma.project.findUnique).mockResolvedValue({ retentionPct: 10, retentionCapPct: null, advancePct: null, paymentTermsDays: 45 } as never)
  vi.mocked(prisma.valuation.findUnique).mockResolvedValue({ id: 'v1', valuationCode: 'VAL-2026-0001', periodMonth: new Date('2026-06-01T00:00:00.000Z'), projectId: 'p1', grossAmount: 1000, netPayable: 900, project: { name: 'Durrat' } } as never)
  vi.mocked(prisma.notificationRecipient.findMany).mockResolvedValue([{ address: 'finance@e.local', userId: null }] as never)
  vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: typeof prisma) => unknown) => fn(prisma)) as never)
})

describe('certify → VALUATION_CERTIFIED notification', () => {
  it('certifies, then notifies the list (after the freeze commits)', async () => {
    const res = await certify(req(), vParams)
    expect(res.status).toBe(200)
    // Freeze committed: the valuation was updated to CERTIFIED.
    const updateData = vi.mocked(prisma.valuation.update).mock.calls[0]![0].data
    expect(updateData.status).toBe('CERTIFIED')
    // The list was notified (no attachment), via the recorded-send path.
    expect(sendRecordedEmail).toHaveBeenCalledTimes(1)
    const sent = vi.mocked(sendRecordedEmail).mock.calls[0]![0]
    expect(sent.entityType).toBe('VALUATION')
    expect(sent.attachment).toBeNull()
    expect(sent.recipients.map((r) => r.address)).toContain('finance@e.local')
  })

  it('a notification failure does not roll back the certification', async () => {
    // sendRecordedEmail already returns { ok:false } in this file — the certify still commits.
    const res = await certify(req(), vParams)
    expect(res.status).toBe(200)
    expect(vi.mocked(prisma.valuation.update).mock.calls[0]![0].data.status).toBe('CERTIFIED')
  })

  it('an empty list sends nothing and does not error', async () => {
    vi.mocked(prisma.notificationRecipient.findMany).mockResolvedValue([] as never)
    const res = await certify(req(), vParams)
    expect(res.status).toBe(200)
    expect(sendRecordedEmail).not.toHaveBeenCalled()
  })
})
