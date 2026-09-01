import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocked prisma so the cron sweep sees a controlled set of projects (never the shared test DB).
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(), recordAuditLog: vi.fn() }))
vi.mock('@/lib/email/send.server', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/email/send.server')>()
  return { ...actual, sendRecordedEmail: vi.fn(async () => ({ ok: true, emailSendId: 'es-1', addresses: ['list@e.local'] })) }
})
vi.mock('@/lib/prisma', () => ({
  prisma: {
    project: { findMany: vi.fn() },
    dailyReport: { findMany: vi.fn() },
    user: { findFirst: vi.fn(), findMany: vi.fn() },
    notificationRecipient: { findMany: vi.fn() },
    emailSend: { findFirst: vi.fn() },
  },
}))

import { sendRecordedEmail } from '@/lib/email/send.server'
import { prisma } from '@/lib/prisma'
import { GET as cron } from '@/app/api/cron/missing-reports/route'

const SECRET = 'sekret-123'
const get = (auth?: string) => new Request('http://test/api/cron/missing-reports', { headers: auth ? { authorization: auth } : {} }) as never

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = SECRET
  // Two active projects; B filed a report today (a DRAFT counts), A filed none → A is missing.
  vi.mocked(prisma.project.findMany).mockResolvedValue([
    { id: 'projA', projectCode: 'PRJ-A', name: 'Alpha' },
    { id: 'projB', projectCode: 'PRJ-B', name: 'Beta' },
  ] as never)
  vi.mocked(prisma.dailyReport.findMany).mockResolvedValue([{ projectId: 'projB' }] as never) // any status counts
  vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: 'sys-admin' } as never)
  vi.mocked(prisma.user.findMany).mockResolvedValue([] as never) // no project supervisors
  vi.mocked(prisma.notificationRecipient.findMany).mockResolvedValue([{ address: 'list@e.local', userId: null }] as never)
  vi.mocked(prisma.emailSend.findFirst).mockResolvedValue(null) // no prior send
})

describe('missing-reports cron', () => {
  it('rejects a request with no bearer secret (401) and sends nothing', async () => {
    const res = await cron(get())
    expect(res.status).toBe(401)
    expect(sendRecordedEmail).not.toHaveBeenCalled()
  })

  it('rejects a mismatched bearer (401)', async () => {
    expect((await cron(get('Bearer wrong'))).status).toBe(401)
  })

  it('fails closed with 401 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET
    expect((await cron(get(`Bearer ${SECRET}`))).status).toBe(401)
  })

  it('notifies the project with no report today; the one with a (draft) report is not notified', async () => {
    const res = await cron(get(`Bearer ${SECRET}`))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.missing).toBe(1)
    expect(sendRecordedEmail).toHaveBeenCalledTimes(1)
    const call = vi.mocked(sendRecordedEmail).mock.calls[0]![0]
    expect(call.entityType).toBe('REPORT_MISSING')
    expect(call.projectId).toBe('projA') // Alpha (missing), never Beta (filed a draft)
    expect(call.entityId).toContain('projA:')
  })

  it('running twice does not send twice (idempotent per project per date)', async () => {
    vi.mocked(prisma.emailSend.findFirst).mockResolvedValue({ id: 'prior-send' } as never) // a send already exists
    const res = await cron(get(`Bearer ${SECRET}`))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.skipped).toBe(1)
    expect(sendRecordedEmail).not.toHaveBeenCalled()
  })
})
