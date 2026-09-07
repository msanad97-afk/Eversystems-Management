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
import { writeAuditLog, recordAuditLog } from '@/lib/audit'
import { PrismaClient } from '@prisma/client'
import { notifyReportRejected, notifyMaterialRequestReviewed, notifyValuationCertified } from '@/lib/notify/events.server'
import { sendRecordedEmail } from '@/lib/email/send.server'

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
  const partial = await prisma.materialRequest.create({
    data: {
      requestCode: `TNE-MR-P-${sfx}`, projectId: project.id, assetId: asset.id, requestedById: author.id, status: 'PARTIALLY_APPROVED', reviewedById: admin.id, reviewedAt: new Date(),
      lines: { create: [{ materialId: material.id, unit: 'bag', requestedQty: 10, approvedQty: 5 }] },
    },
  })
  ids.partialReqId = partial.id

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
    // The VALUATION_CERTIFIED list is GLOBAL (getListRecipients returns every row of the type), so
    // these rows are visible to any concurrent test file's certify. Delete them the instant the
    // assertion is done (finally) to keep the exposure window to this single test. The real defence
    // is the transport guard in transport.ts; this only narrows the race. (Incident 01/09.)
    await prisma.notificationRecipient.createMany({ data: [
      { type: 'VALUATION_CERTIFIED', address: `finance_${sfx}@e.local` },
      { type: 'VALUATION_CERTIFIED', address: `qs_${sfx}@e.local` },
    ] })
    try {
      await notifyValuationCertified(ids.valuationId!, ids.adminId!)
      const mail = lastMail()
      expect(mail?.to).toContain(`finance_${sfx}@e.local`)
      expect(mail?.to).toContain(`qs_${sfx}@e.local`)
      expect(mail?.attachments).toBeUndefined()
    } finally {
      await prisma.notificationRecipient.deleteMany({ where: { type: 'VALUATION_CERTIFIED', address: { contains: sfx } } })
    }
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

// The ACCOUNTS / MATERIAL_REQUEST_MANAGEMENT lists are GLOBAL. Create them only inside a test and
// delete them in finally, so no concurrent file's material-request review sees them (incident 01/09).
async function withAccountsLists(fn: () => Promise<void>) {
  await prisma.notificationRecipient.createMany({ data: [
    { type: 'ACCOUNTS', address: `accounts_${sfx}@e.local` },
    { type: 'MATERIAL_REQUEST_MANAGEMENT', address: `mgmt_${sfx}@e.local` },
  ] })
  try { await fn() } finally {
    await prisma.notificationRecipient.deleteMany({ where: { address: { contains: sfx }, type: { in: ['ACCOUNTS', 'MATERIAL_REQUEST_MANAGEMENT'] } } })
  }
}

describe('4. material request approved → accounts, cc supervisor + management (one email)', () => {
  it('an APPROVED request emails accounts, cc supervisor + management, letter attached', async () => {
    await withAccountsLists(async () => {
      await notifyMaterialRequestReviewed(ids.approvedReqId!, 'APPROVED', 'Order it.', ids.adminId!)
      expect(sendMail).toHaveBeenCalledTimes(1) // ONE email, not two
      const mail = lastMail()
      expect(mail?.to).toContain(`accounts_${sfx}@e.local`)
      expect(mail?.cc).toContain(ids.authorEmail) // supervisor copied
      expect(mail?.cc).toContain(`mgmt_${sfx}@e.local`) // management copied
      expect(mail?.to).not.toContain(ids.authorEmail) // supervisor is NOT a To
      expect(mail?.attachments).toHaveLength(1) // procurement letter
      expect(mail?.subject).toMatch(/purchase authorisation/i) // an order, not an FYI
    })
  })

  it('a PARTIALLY_APPROVED request does the same', async () => {
    await withAccountsLists(async () => {
      await notifyMaterialRequestReviewed(ids.partialReqId!, 'PARTIALLY_APPROVED', null, ids.adminId!)
      expect(sendMail).toHaveBeenCalledTimes(1)
      const mail = lastMail()
      expect(mail?.to).toContain(`accounts_${sfx}@e.local`)
      expect(mail?.cc).toContain(ids.authorEmail)
      expect(mail?.cc).toContain(`mgmt_${sfx}@e.local`)
      expect(mail?.attachments).toHaveLength(1)
    })
  })

  it('a REJECTED request notifies only the requester — no accounts, no attachment', async () => {
    await withAccountsLists(async () => {
      await notifyMaterialRequestReviewed(ids.rejectedReqId!, 'REJECTED', 'Not this cycle.', ids.adminId!)
      expect(sendMail).toHaveBeenCalledTimes(1)
      const mail = lastMail()
      expect(mail?.to).toBe(ids.authorEmail)
      expect(mail?.cc).toBeUndefined()
      expect(mail?.to).not.toContain(`accounts_${sfx}@e.local`)
      expect(mail?.attachments).toBeUndefined()
    })
  })

  it('an empty ACCOUNTS list falls back to the requester and records why', async () => {
    // No accounts recipients exist here (withAccountsLists always cleans up). The approval must still
    // reach the requester, and the skip must be audited — never silently un-ordered.
    vi.mocked(recordAuditLog).mockClear()
    await notifyMaterialRequestReviewed(ids.approvedReqId!, 'APPROVED', 'x', ids.adminId!)
    expect(sendMail).toHaveBeenCalledTimes(1)
    const mail = lastMail()
    expect(mail?.to).toBe(ids.authorEmail) // fell back to the requester
    expect(mail?.cc).toBeUndefined()
    expect(mail?.attachments).toHaveLength(1) // letter still attached
    const audit = vi.mocked(recordAuditLog).mock.calls.map((c) => c[0]).find((a) => a.action === 'NOTIFICATION_SENT' && a.entity === 'MaterialRequest')
    expect(audit?.metadata).toMatchObject({ recipientCount: 0, skipped: 'empty accounts list', fallback: 'requester' })
  })
})

describe('5. sendRecordedEmail — To/Cc roles', () => {
  it('no role → every address on To, nothing on Cc, and rows default to TO (unchanged)', async () => {
    await sendRecordedEmail({
      subject: 'x', bodyText: 'y', recipients: [{ address: `plain_${sfx}@e.local` }], attachment: null,
      entityType: 'MATERIAL_REQUEST', entityId: `no-role-${sfx}`, entityCode: 'NR', projectId: ids.projectId, sentById: ids.adminId!,
    })
    const mail = lastMail()
    expect(mail?.to).toBe(`plain_${sfx}@e.local`)
    expect(mail?.cc).toBeUndefined()
    const rows = await prisma.emailRecipient.findMany({ where: { emailSend: { entityId: `no-role-${sfx}` } }, select: { role: true } })
    expect(rows.length).toBe(1)
    expect(rows.every((r) => r.role === 'TO')).toBe(true)
  })

  it('records who was on Cc versus To in the EmailSend register', async () => {
    await sendRecordedEmail({
      subject: 'x', bodyText: 'y',
      recipients: [{ address: `to_${sfx}@e.local`, role: 'TO' }, { address: `cc_${sfx}@e.local`, role: 'CC' }],
      attachment: null, entityType: 'MATERIAL_REQUEST', entityId: `roles-${sfx}`, entityCode: 'RR', projectId: ids.projectId, sentById: ids.adminId!,
    })
    const mail = lastMail()
    expect(mail?.to).toBe(`to_${sfx}@e.local`)
    expect(mail?.cc).toBe(`cc_${sfx}@e.local`)
    const rows = await prisma.emailRecipient.findMany({ where: { emailSend: { entityId: `roles-${sfx}` } }, select: { address: true, role: true } })
    expect(rows.find((r) => r.address === `to_${sfx}@e.local`)?.role).toBe('TO')
    expect(rows.find((r) => r.address === `cc_${sfx}@e.local`)?.role).toBe('CC')
  })
})
