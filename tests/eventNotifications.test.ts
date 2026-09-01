import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'

// DB-backed: the four event notifiers, exercised directly. Real prisma; only the mail transport and
// the PDF renderers are mocked, so no real email is sent and no fonts are loaded. writeAuditLog is
// spied to assert the empty-list case records WHY it sent nothing.
vi.mock('@/lib/email/transport', () => ({ sendMail: vi.fn() }))
vi.mock('@/lib/pdf/render', () => ({
  renderReportPdf: vi.fn(async () => Buffer.from('%PDF-1.7 report')),
  renderMaterialRequestPdf: vi.fn(async () => Buffer.from('%PDF-1.7 letter')),
}))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(), recordAuditLog: vi.fn() }))

import { sendMail } from '@/lib/email/transport'
import { writeAuditLog } from '@/lib/audit'
import { PrismaClient } from '@prisma/client'
import { notifyReportRejected, notifyMaterialRequestReviewed, notifyValuationCertified } from '@/lib/notify/events.server'

const prisma = new PrismaClient()
const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const ids: Record<string, string> = {}
const lastMail = () => vi.mocked(sendMail).mock.calls.at(-1)?.[0]

beforeAll(async () => {
  const admin = await prisma.user.create({ data: { userCode: `TNE-A-${sfx}`, email: `tne_a_${sfx}@e.local`, passwordHash: 'x', firstName: 'Ada', lastName: 'Admin', role: 'ADMIN' } })
  const author = await prisma.user.create({ data: { userCode: `TNE-U-${sfx}`, email: `tne_u_${sfx}@e.local`, passwordHash: 'x', firstName: 'Sam', lastName: 'Super', role: 'SUPERVISOR' } })
  ids.adminId = admin.id; ids.authorId = author.id; ids.authorEmail = author.email

  const project = await prisma.project.create({ data: { projectCode: `TNE-P-${sfx}`, name: `Notify ${sfx}`, createdBy: admin.id } })
  ids.projectId = project.id
  const asset = await prisma.asset.create({ data: { projectId: project.id, name: 'Tower A' } })
  const material = await prisma.material.create({ data: { name: `Cement ${sfx}`, unit: 'bag' } })
  ids.materialId = material.id

  // A submitted report authored by the supervisor (for the rejected-report notification).
  const report = await prisma.dailyReport.create({ data: { reportCode: `TNE-DR-${sfx}`, projectId: project.id, authorId: author.id, reportDate: new Date('2026-06-01T00:00:00.000Z'), status: 'SUBMITTED' } })
  ids.reportId = report.id; ids.reportCode = report.reportCode

  // An APPROVED material request (letter exists) and a REJECTED one (no letter).
  const approved = await prisma.materialRequest.create({
    data: {
      requestCode: `TNE-MR-A-${sfx}`, projectId: project.id, assetId: asset.id, requestedById: author.id, status: 'APPROVED', reviewedById: admin.id, reviewedAt: new Date(),
      lines: { create: [{ materialId: material.id, unit: 'bag', requestedQty: 10, approvedQty: 8 }] },
    },
  })
  ids.approvedReqId = approved.id
  const rejected = await prisma.materialRequest.create({
    data: {
      requestCode: `TNE-MR-R-${sfx}`, projectId: project.id, assetId: asset.id, requestedById: author.id, status: 'REJECTED', reviewedById: admin.id, reviewedAt: new Date(),
      lines: { create: [{ materialId: material.id, unit: 'bag', requestedQty: 10, approvedQty: 0 }] },
    },
  })
  ids.rejectedReqId = rejected.id

  // A CERTIFIED valuation (for the certify notification).
  const val = await prisma.valuation.create({
    data: { valuationCode: `TNE-VAL-${sfx}`, projectId: project.id, periodMonth: new Date('2026-06-01T00:00:00.000Z'), progressPct: 40, cumulativeMeasured: 800, cumulativeLumpsum: 0, grossAmount: 800, previousGross: 0, retentionHeld: 40, advanceRecovery: 0, netPayable: 760, status: 'CERTIFIED', certifiedAt: new Date(), createdBy: admin.id },
  })
  ids.valuationId = val.id
})

afterAll(async () => {
  if (ids.projectId) await prisma.notificationRecipient.deleteMany({ where: { address: { contains: sfx } } })
  if (ids.projectId) await prisma.emailSend.deleteMany({ where: { projectId: ids.projectId } }) // cascades recipients
  if (ids.projectId) await prisma.valuation.deleteMany({ where: { projectId: ids.projectId } })
  if (ids.projectId) await prisma.materialRequest.deleteMany({ where: { projectId: ids.projectId } }) // cascades lines
  await prisma.dailyReport.deleteMany({ where: { reportCode: { startsWith: `TNE-DR-${sfx}` } } })
  if (ids.projectId) await prisma.project.deleteMany({ where: { id: ids.projectId } })
  if (ids.materialId) await prisma.material.deleteMany({ where: { id: ids.materialId } })
  await prisma.user.deleteMany({ where: { id: { in: [ids.adminId, ids.authorId].filter((x): x is string => Boolean(x)) } } })
  await prisma.$disconnect()
})

beforeEach(() => vi.mocked(sendMail).mockClear())

describe('1. report rejected → author, review note verbatim', () => {
  it('emails the author with the rejection note', async () => {
    await notifyReportRejected(ids.reportId!, 'Rain — resubmit tomorrow.', ids.adminId!)
    const mail = lastMail()
    expect(mail?.to).toBe(ids.authorEmail)
    expect(mail?.text).toContain('Rain — resubmit tomorrow.')
    expect(mail?.attachments).toBeUndefined()
  })
})

describe('2. material request reviewed → requester', () => {
  it('an approved request attaches the procurement letter', async () => {
    await notifyMaterialRequestReviewed(ids.approvedReqId!, 'APPROVED', 'Approved in full.', ids.adminId!)
    const mail = lastMail()
    expect(mail?.to).toBe(ids.authorEmail)
    expect(mail?.attachments).toHaveLength(1)
  })
  it('a fully-rejected request still notifies, without an attachment', async () => {
    await notifyMaterialRequestReviewed(ids.rejectedReqId!, 'REJECTED', 'Not this cycle.', ids.adminId!)
    const mail = lastMail()
    expect(mail?.to).toBe(ids.authorEmail)
    expect(mail?.attachments).toBeUndefined() // resolver returns null → no attachment, still sent
  })
})

describe('3. valuation certified → the VALUATION_CERTIFIED list', () => {
  it('emails everyone on the list, no attachment', async () => {
    await prisma.notificationRecipient.createMany({ data: [
      { type: 'VALUATION_CERTIFIED', address: `finance_${sfx}@e.local` },
      { type: 'VALUATION_CERTIFIED', address: `qs_${sfx}@e.local` },
    ] })
    await notifyValuationCertified(ids.valuationId!, ids.adminId!)
    const mail = lastMail()
    expect(mail?.to).toContain(`finance_${sfx}@e.local`)
    expect(mail?.to).toContain(`qs_${sfx}@e.local`)
    expect(mail?.attachments).toBeUndefined()
  })

  it('an empty list sends nothing and records why in the audit (no error)', async () => {
    await prisma.notificationRecipient.deleteMany({ where: { type: 'VALUATION_CERTIFIED', address: { contains: sfx } } })
    vi.mocked(writeAuditLog).mockClear()
    await expect(notifyValuationCertified(ids.valuationId!, ids.adminId!)).resolves.toBeUndefined()
    expect(sendMail).not.toHaveBeenCalled()
    const audit = vi.mocked(writeAuditLog).mock.calls.map((c) => c[0]).find((a) => a.action === 'NOTIFICATION_SENT')
    expect(audit?.metadata).toMatchObject({ recipientCount: 0, skipped: 'empty list' })
  })
})
