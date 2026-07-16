import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/email', () => ({
  sendReportSubmittedEmail: vi.fn(),
  sendReportReviewedEmail: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { dailyReport: { findUnique: vi.fn() }, user: { findMany: vi.fn() } },
}))

import { prisma } from '@/lib/prisma'
import { sendReportSubmittedEmail, sendReportReviewedEmail } from '@/lib/email'
import { notifyReportSubmitted, notifyReportReviewed } from '@/lib/notifications'

const reportRow = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  reportCode: 'DR-2026-0001',
  reportDate: new Date('2026-07-14T00:00:00.000Z'),
  project: { name: 'Site Alpha' },
  author: { firstName: 'Sam', lastName: 'Supervisor', email: 'sam@e.local', status: 'ACTIVE' },
  ...over,
})

beforeEach(() => vi.clearAllMocks())

describe('notifyReportSubmitted', () => {
  it('sends exactly one email to all active admins', async () => {
    vi.mocked(prisma.dailyReport.findUnique).mockResolvedValue(reportRow() as never)
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ email: 'a@x' }, { email: 'b@x' }] as never)

    await notifyReportSubmitted('r1')

    expect(sendReportSubmittedEmail).toHaveBeenCalledTimes(1)
    const [recipients, ctx] = vi.mocked(sendReportSubmittedEmail).mock.calls[0]!
    expect(recipients).toEqual(['a@x', 'b@x'])
    expect(ctx.reportCode).toBe('DR-2026-0001')
    expect(ctx.reportDate).toBe('2026-07-14')
  })

  it('does nothing when the report is missing', async () => {
    vi.mocked(prisma.dailyReport.findUnique).mockResolvedValue(null as never)
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never)
    await notifyReportSubmitted('missing')
    expect(sendReportSubmittedEmail).not.toHaveBeenCalled()
  })
})

describe('notifyReportReviewed', () => {
  it('emails the author once on approval', async () => {
    vi.mocked(prisma.dailyReport.findUnique).mockResolvedValue(reportRow() as never)
    await notifyReportReviewed('r1', 'APPROVED')
    expect(sendReportReviewedEmail).toHaveBeenCalledTimes(1)
    const [to, ctx] = vi.mocked(sendReportReviewedEmail).mock.calls[0]!
    expect(to).toBe('sam@e.local')
    expect(ctx.decision).toBe('APPROVED')
  })

  it('emails the author once on rejection, carrying the note', async () => {
    vi.mocked(prisma.dailyReport.findUnique).mockResolvedValue(reportRow() as never)
    await notifyReportReviewed('r1', 'REJECTED', 'Add rebar tonnage')
    expect(sendReportReviewedEmail).toHaveBeenCalledTimes(1)
    const [, ctx] = vi.mocked(sendReportReviewedEmail).mock.calls[0]!
    expect(ctx.decision).toBe('REJECTED')
    expect(ctx.note).toBe('Add rebar tonnage')
  })

  it('skips an inactive author', async () => {
    vi.mocked(prisma.dailyReport.findUnique).mockResolvedValue(
      reportRow({ author: { firstName: 'S', lastName: 'X', email: 's@e', status: 'INACTIVE' } }) as never,
    )
    await notifyReportReviewed('r1', 'APPROVED')
    expect(sendReportReviewedEmail).not.toHaveBeenCalled()
  })
})
