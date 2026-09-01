import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'

// DB-backed: a notification failure must NOT roll back the reject / review action. Real prisma; the
// recorded send is made to fail (exactly what a transport outage yields — sendRecordedEmail records
// FAILED and returns { ok: false }, never throwing). We assert the status change still committed.
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(), recordAuditLog: vi.fn() }))
vi.mock('@/lib/pdf/render', () => ({
  renderReportPdf: vi.fn(async () => Buffer.from('%PDF report')),
  renderMaterialRequestPdf: vi.fn(async () => Buffer.from('%PDF letter')),
}))
vi.mock('@/lib/email/send.server', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/email/send.server')>()
  return { ...actual, sendRecordedEmail: vi.fn(async () => ({ ok: false, emailSendId: null, error: 'SMTP 421 — transport down' })) }
})

import { getServerSession } from 'next-auth'
import { sendRecordedEmail } from '@/lib/email/send.server'
import { PrismaClient } from '@prisma/client'
import { POST as rejectReport } from '@/app/api/reports/[id]/reject/route'
import { POST as reviewRequest } from '@/app/api/material-requests/[id]/review/route'
import { POST as addRecipient } from '@/app/api/admin/notification-recipients/route'

const prisma = new PrismaClient()
const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const ids: Record<string, string> = {}

// requireAdmin re-reads the real user from the DB, so we only stub the session id.
function actAs(userId: string) {
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: userId } } as never)
}
const req = (body?: unknown) =>
  new Request('http://test/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }) as never

beforeAll(async () => {
  const admin = await prisma.user.create({ data: { userCode: `TNR-A-${sfx}`, email: `tnr_a_${sfx}@e.local`, passwordHash: 'x', firstName: 'Ada', lastName: 'Admin', role: 'ADMIN' } })
  const author = await prisma.user.create({ data: { userCode: `TNR-U-${sfx}`, email: `tnr_u_${sfx}@e.local`, passwordHash: 'x', firstName: 'Sam', lastName: 'Super', role: 'SUPERVISOR' } })
  ids.adminId = admin.id; ids.authorId = author.id
  const project = await prisma.project.create({ data: { projectCode: `TNR-P-${sfx}`, name: `Rollback ${sfx}`, createdBy: admin.id } })
  ids.projectId = project.id
  const asset = await prisma.asset.create({ data: { projectId: project.id, name: 'Tower A' } })
  const material = await prisma.material.create({ data: { name: `Cement ${sfx}`, unit: 'bag' } })
  ids.materialId = material.id

  const report = await prisma.dailyReport.create({ data: { reportCode: `TNR-DR-${sfx}`, projectId: project.id, authorId: author.id, reportDate: new Date('2026-06-01T00:00:00.000Z'), status: 'SUBMITTED' } })
  ids.reportId = report.id

  const request = await prisma.materialRequest.create({
    data: { requestCode: `TNR-MR-${sfx}`, projectId: project.id, assetId: asset.id, requestedById: author.id, status: 'SUBMITTED', lines: { create: [{ materialId: material.id, unit: 'bag', requestedQty: 10 }] } },
    include: { lines: true },
  })
  ids.requestId = request.id; ids.lineId = request.lines[0]!.id
})

afterAll(async () => {
  if (ids.projectId) await prisma.materialRequest.deleteMany({ where: { projectId: ids.projectId } })
  await prisma.dailyReport.deleteMany({ where: { reportCode: { startsWith: `TNR-DR-${sfx}` } } })
  if (ids.projectId) await prisma.project.deleteMany({ where: { id: ids.projectId } })
  if (ids.materialId) await prisma.material.deleteMany({ where: { id: ids.materialId } })
  await prisma.user.deleteMany({ where: { id: { in: [ids.adminId, ids.authorId].filter((x): x is string => Boolean(x)) } } })
  await prisma.$disconnect()
})

beforeEach(() => vi.mocked(sendRecordedEmail).mockClear())

describe('a notification failure does not roll back the action', () => {
  it('reject: the report is REJECTED even though the notification fails', async () => {
    actAs(ids.adminId!)
    const res = await rejectReport(req({ note: 'Rain — resubmit.' }), { params: { id: ids.reportId! } })
    expect(res.status).toBe(200)
    expect(vi.mocked(sendRecordedEmail)).toHaveBeenCalled() // it did attempt to notify
    const report = await prisma.dailyReport.findUniqueOrThrow({ where: { id: ids.reportId }, select: { status: true, reviewNote: true } })
    expect(report.status).toBe('REJECTED') // committed
    expect(report.reviewNote).toBe('Rain — resubmit.')
  })

  it('review: the request is committed even though the notification fails', async () => {
    actAs(ids.adminId!)
    const res = await reviewRequest(req({ decisions: [{ lineId: ids.lineId, approvedQty: 10 }] }), { params: { id: ids.requestId! } })
    expect(res.status).toBe(200)
    expect(vi.mocked(sendRecordedEmail)).toHaveBeenCalled()
    const request = await prisma.materialRequest.findUniqueOrThrow({ where: { id: ids.requestId }, select: { status: true, lines: { select: { approvedQty: true } } } })
    expect(request.status).toBe('APPROVED') // committed in full
    expect(Number(request.lines[0]!.approvedQty)).toBe(10)
  })
})

describe('settings endpoint is ADMIN only', () => {
  it('a supervisor is rejected (403)', async () => {
    actAs(ids.authorId!)
    const res = await addRecipient(req({ type: 'VALUATION_CERTIFIED', address: 'x@e.local' }))
    expect(res.status).toBe(403)
  })
})
