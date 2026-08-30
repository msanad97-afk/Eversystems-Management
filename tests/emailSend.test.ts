import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Role } from '@prisma/client'

/**
 * Manual document send (Phase A). The transport is MOCKED throughout — no test ever touches
 * Brevo or sends a real email.
 *
 * The invariants under test: only an admin can send, only a finished document can be sent,
 * a bad recipient list is rejected whole (nothing recorded), a dead transport is RECORDED as
 * FAILED instead of thrown, and the daily-report attachment carries no cost.
 */

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(), recordAuditLog: vi.fn() }))
vi.mock('@/lib/email/transport', () => ({ sendMail: vi.fn() }))
vi.mock('@/lib/pdf/render', () => ({
  renderReportPdf: vi.fn(async () => Buffer.from('%PDF-1.7 report')),
  renderMaterialRequestPdf: vi.fn(async () => Buffer.from('%PDF-1.7 letter')),
}))
vi.mock('@/lib/reports/pdfData.server', () => ({ loadReportPdfData: vi.fn() }))
vi.mock('@/lib/materialRequests/letter.server', () => ({ loadMaterialRequestLetter: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    materialRequest: { findUnique: vi.fn() },
    emailSend: { create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}))

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { sendMail } from '@/lib/email/transport'
import { writeAuditLog } from '@/lib/audit'
import { renderReportPdf } from '@/lib/pdf/render'
import { loadReportPdfData } from '@/lib/reports/pdfData.server'
import { loadMaterialRequestLetter } from '@/lib/materialRequests/letter.server'
import { POST as sendEmail } from '@/app/api/email/send/route'

const ADMIN_ID = 'admin-1'
const SECRET_COST = 12.345 // a cost value that must never reach an attachment payload

function actAs(role: Role, id = ADMIN_ID) {
  vi.mocked(getServerSession).mockResolvedValue({ user: { id } } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    id, email: 'admin@e.local', userCode: 'USR-1', firstName: 'Adam', lastName: 'Admin',
    role, status: 'ACTIVE', mustChangePassword: false,
  } as never)
}

/** The report PDF payload the shared loader hands back — quantities only, as it really selects. */
function reportBundle(status = 'APPROVED') {
  return {
    reportId: 'r1',
    reportCode: 'DR-2026-0001',
    projectId: 'p1',
    authorId: 'sup-1',
    status,
    projectName: 'Site Alpha',
    reportDate: '2026-07-14',
    data: {
      reportCode: 'DR-2026-0001',
      reportDate: '2026-07-14',
      status,
      weather: 'Hot',
      generalNotes: null,
      project: { name: 'Site Alpha', projectCode: 'PRJ-2026-001', location: 'Manama' },
      author: { name: 'Sam Supervisor' },
      activities: [
        {
          assetName: 'Tower A', activityName: 'Blockwork', ref: '3.2.1',
          subs: [{
            name: 'Base coat', isImplicit: false, type: 'MEASURED', unit: 'm2',
            quantityDone: 120, percentComplete: null, cumulativePercent: 24, earnedBhd: null, note: null,
            manpower: [{ categoryName: 'Mason', headcount: 10, hours: 8 }],
            materials: [{ materialName: 'OPC Cement', unit: 'bag', quantity: 120 }],
          }],
        },
      ],
      totals: { workers: 10, manHours: 80 },
      generatedAt: '14/07/2026, 09:00:00',
    },
  }
}

const req = (body?: unknown) =>
  new Request('http://test/api/email/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any

const RECIPIENT = { id: 'u9', email: 'Foreman@Site.local', firstName: 'Fay', lastName: 'Foreman' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: typeof prisma) => unknown) => fn(prisma)) as never)
  vi.mocked(prisma.emailSend.create).mockResolvedValue({ id: 'es-1' } as never)
  vi.mocked(prisma.emailSend.update).mockResolvedValue({} as never)
  vi.mocked(prisma.user.findMany).mockResolvedValue([RECIPIENT] as never)
  vi.mocked(loadReportPdfData).mockResolvedValue(reportBundle() as never)
  vi.mocked(sendMail).mockResolvedValue(undefined as never)
})

describe('POST /api/email/send — permissions', () => {
  it('an admin can send an approved report', async () => {
    actAs('ADMIN')
    const res = await sendEmail(req({ entityType: 'DAILY_REPORT', entityId: 'r1', userIds: ['u9'], addresses: [] }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, attachmentName: 'DR-2026-0001.pdf' })
    expect(sendMail).toHaveBeenCalledTimes(1)
  })

  it('a SUPERVISOR is rejected (403) — sending is admin-only, nothing recorded or sent', async () => {
    actAs('SUPERVISOR')
    const res = await sendEmail(req({ entityType: 'DAILY_REPORT', entityId: 'r1', userIds: ['u9'], addresses: [] }))
    expect(res.status).toBe(403)
    expect(prisma.emailSend.create).not.toHaveBeenCalled()
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('a VIEWER is rejected (403)', async () => {
    actAs('VIEWER')
    expect((await sendEmail(req({ entityType: 'DAILY_REPORT', entityId: 'r1', userIds: ['u9'] }))).status).toBe(403)
    expect(sendMail).not.toHaveBeenCalled()
  })
})

describe('POST /api/email/send — sendable state', () => {
  for (const status of ['DRAFT', 'SUBMITTED'] as const) {
    it(`a ${status} report cannot be sent (409) and nothing is recorded`, async () => {
      actAs('ADMIN')
      vi.mocked(loadReportPdfData).mockResolvedValue(reportBundle(status) as never)
      const res = await sendEmail(req({ entityType: 'DAILY_REPORT', entityId: 'r1', userIds: ['u9'] }))
      expect(res.status).toBe(409)
      expect((await res.json()).error).toContain('approved report')
      expect(prisma.emailSend.create).not.toHaveBeenCalled()
      expect(sendMail).not.toHaveBeenCalled()
    })
  }

  it('a REJECTED report cannot be sent (409)', async () => {
    actAs('ADMIN')
    vi.mocked(loadReportPdfData).mockResolvedValue(reportBundle('REJECTED') as never)
    expect((await sendEmail(req({ entityType: 'DAILY_REPORT', entityId: 'r1', userIds: ['u9'] }))).status).toBe(409)
  })

  it('an unreviewed material request cannot be sent (409); a reviewed one can', async () => {
    actAs('ADMIN')
    const mreq = (status: string) => ({
      id: 'mr1', requestCode: 'MR-2026-0001', status, projectId: 'p1', project: { name: 'Site Alpha' },
    })

    vi.mocked(prisma.materialRequest.findUnique).mockResolvedValue(mreq('SUBMITTED') as never)
    const blocked = await sendEmail(req({ entityType: 'MATERIAL_REQUEST', entityId: 'mr1', userIds: ['u9'] }))
    expect(blocked.status).toBe(409)
    expect(prisma.emailSend.create).not.toHaveBeenCalled()

    vi.mocked(prisma.materialRequest.findUnique).mockResolvedValue(mreq('APPROVED') as never)
    vi.mocked(loadMaterialRequestLetter).mockResolvedValue({ data: { requestCode: 'MR-2026-0001' }, requestedById: 'sup-1' } as never)
    const ok = await sendEmail(req({ entityType: 'MATERIAL_REQUEST', entityId: 'mr1', userIds: ['u9'] }))
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ attachmentName: 'MR-2026-0001.pdf' })
  })

  it('a DRAFT material request cannot be sent (409)', async () => {
    actAs('ADMIN')
    vi.mocked(prisma.materialRequest.findUnique).mockResolvedValue({
      id: 'mr1', requestCode: 'MR-2026-0002', status: 'DRAFT', projectId: 'p1', project: { name: 'Site Alpha' },
    } as never)
    const res = await sendEmail(req({ entityType: 'MATERIAL_REQUEST', entityId: 'mr1', userIds: ['u9'] }))
    expect(res.status).toBe(409)
    expect(prisma.emailSend.create).not.toHaveBeenCalled()
  })
})

describe('POST /api/email/send — recipient validation', () => {
  it('a malformed address rejects the WHOLE request (400) — no EmailSend row, nothing sent', async () => {
    actAs('ADMIN')
    const res = await sendEmail(
      req({ entityType: 'DAILY_REPORT', entityId: 'r1', userIds: ['u9'], addresses: ['good@x.com', 'not-an-email'] }),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('not-an-email')
    expect(prisma.emailSend.create).not.toHaveBeenCalled()
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('no recipients at all leaves nothing to send (400)', async () => {
    actAs('ADMIN')
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never)
    const res = await sendEmail(req({ entityType: 'DAILY_REPORT', entityId: 'r1', userIds: [], addresses: [] }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('at least one recipient')
    expect(prisma.emailSend.create).not.toHaveBeenCalled()
  })

  it('an inactive or unknown selected user rejects the request rather than sending to fewer people', async () => {
    actAs('ADMIN')
    vi.mocked(prisma.user.findMany).mockResolvedValue([RECIPIENT] as never) // only 1 of the 2 asked for
    const res = await sendEmail(req({ entityType: 'DAILY_REPORT', entityId: 'r1', userIds: ['u9', 'gone'] }))
    expect(res.status).toBe(400)
    expect(prisma.emailSend.create).not.toHaveBeenCalled()
  })
})

describe('POST /api/email/send — the EmailSend record', () => {
  it('records recipients, entity code and sender; the app user keeps its userId', async () => {
    actAs('ADMIN')
    const res = await sendEmail(
      req({
        entityType: 'DAILY_REPORT', entityId: 'r1', userIds: ['u9'],
        addresses: ['buyer@supplier.com'], message: 'For your records.',
      }),
    )
    expect(res.status).toBe(200)

    const created = vi.mocked(prisma.emailSend.create).mock.calls[0]![0].data
    expect(created.entityCode).toBe('DR-2026-0001')
    expect(created.entityType).toBe('DAILY_REPORT')
    expect(created.sentById).toBe(ADMIN_ID)
    expect(created.projectId).toBe('p1')
    expect(created.attachmentName).toBe('DR-2026-0001.pdf')
    expect(created.status).toBe('PENDING') // written BEFORE the transport is touched
    expect(created.bodyText).toContain('For your records.')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (created.recipients as any).create as { address: string; userId: string | null }[]
    expect(rows.map((r) => r.address).sort()).toEqual(['buyer@supplier.com', 'foreman@site.local'])
    expect(rows.find((r) => r.address === 'foreman@site.local')!.userId).toBe('u9')
    expect(rows.find((r) => r.address === 'buyer@supplier.com')!.userId).toBeNull()

    // Settled to SENT once the transport returned.
    expect(vi.mocked(prisma.emailSend.update).mock.calls[0]![0].data).toMatchObject({ status: 'SENT' })
  })

  it('audits the send, naming the entity, recipient count and external inclusion', async () => {
    actAs('ADMIN')
    await sendEmail(req({ entityType: 'DAILY_REPORT', entityId: 'r1', userIds: ['u9'], addresses: ['buyer@supplier.com'] }))
    const audit = vi.mocked(writeAuditLog).mock.calls[0]![0]
    expect(audit.action).toBe('EMAIL_SENT')
    expect(audit.entity).toBe('DailyReport')
    expect(audit.entityCode).toBe('DR-2026-0001')
    expect(audit.metadata).toMatchObject({ recipientCount: 2, externalIncluded: true, status: 'SENT' })
  })

  it('marks externalIncluded false when every recipient is an app user', async () => {
    actAs('ADMIN')
    await sendEmail(req({ entityType: 'DAILY_REPORT', entityId: 'r1', userIds: ['u9'], addresses: [] }))
    expect(vi.mocked(writeAuditLog).mock.calls[0]![0].metadata).toMatchObject({ recipientCount: 1, externalIncluded: false })
  })
})

describe('POST /api/email/send — transport failure', () => {
  it('records FAILED with the message and does not throw out of the route', async () => {
    actAs('ADMIN')
    vi.mocked(sendMail).mockRejectedValue(new Error('SMTP 421 service unavailable'))

    const res = await sendEmail(req({ entityType: 'DAILY_REPORT', entityId: 'r1', userIds: ['u9'] }))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toContain('was not sent')
    expect(body.error).toContain('SMTP 421 service unavailable')

    const settled = vi.mocked(prisma.emailSend.update).mock.calls[0]![0].data
    expect(settled.status).toBe('FAILED')
    expect(settled.errorMessage).toBe('SMTP 421 service unavailable')
    expect(vi.mocked(writeAuditLog).mock.calls[0]![0].metadata).toMatchObject({ status: 'FAILED' })
  })
})

describe('money wall — the daily-report attachment carries no cost', () => {
  it('renders from the quantities-only payload and puts no cost in the mail', async () => {
    actAs('ADMIN')
    await sendEmail(req({ entityType: 'DAILY_REPORT', entityId: 'r1', userIds: ['u9'], addresses: [] }))

    // The payload handed to the renderer is the shared loader's — assert no cost reached it.
    const payload = JSON.stringify(vi.mocked(renderReportPdf).mock.calls[0]![0])
    for (const forbidden of ['unitRate', 'costRate', 'actualCost', 'lumpsumBhd', String(SECRET_COST)]) {
      expect(payload).not.toContain(forbidden)
    }

    // …and nothing cost-shaped leaked into the subject, body or attachment metadata.
    const mail = vi.mocked(sendMail).mock.calls[0]![0]
    expect(`${mail.subject} ${mail.text} ${mail.html}`).not.toMatch(/BHD|unitRate|cost/i)
    expect(mail.attachments![0]!.filename).toBe('DR-2026-0001.pdf')
    expect(mail.attachments![0]!.contentType).toBe('application/pdf')
    expect(Buffer.isBuffer(mail.attachments![0]!.content)).toBe(true)
  })

  it('never puts a blob or signed URL in the body', async () => {
    actAs('ADMIN')
    await sendEmail(req({ entityType: 'DAILY_REPORT', entityId: 'r1', userIds: ['u9'], message: 'note' }))
    const mail = vi.mocked(sendMail).mock.calls[0]![0]
    expect(`${mail.text} ${mail.html}`).not.toMatch(/https?:\/\/|blob\.vercel-storage|X-Amz-Signature/i)
  })
})
