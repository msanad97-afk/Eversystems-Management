import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'

// Integration: real DB + mocked auth + mocked blob storage, exercising the attachment routes.
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(), recordAuditLog: vi.fn() }))
vi.mock('@/lib/deliveries/blob.server', () => ({
  uploadDeliveryAttachment: vi.fn(async (deliveryId: string) => `deliveries/${deliveryId}/note.pdf-MOCKEDBLOB`),
  signedAttachmentUrl: vi.fn(async () => 'https://signed.example/note?token=short-lived'),
  ALLOWED_ATTACHMENT_TYPES: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  MAX_ATTACHMENT_BYTES: 10 * 1024 * 1024,
}))

import { getServerSession } from 'next-auth'
import { POST as upload, GET as view } from '@/app/api/reports/[id]/deliveries/[deliveryId]/attachment/route'
import { loadReportDeliveries } from '@/lib/deliveries/deliveries.server'

const prisma = new PrismaClient()
const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const id: Record<string, string> = {}

function actAs(userId: string) {
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: userId } } as never)
}
function fileReq(opts: { type?: string; size?: number; name?: string } = {}) {
  const bytes = new Uint8Array(opts.size ?? 128)
  const file = new File([bytes], opts.name ?? 'note.pdf', { type: opts.type ?? 'application/pdf' })
  const fd = new FormData()
  fd.append('file', file)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Request('http://test/x', { method: 'POST', body: fd }) as any
}
const uploadCall = (delId: string, req: unknown) => upload(req as never, { params: { id: id.reportDraft!, deliveryId: delId } })

beforeAll(async () => {
  const author = await prisma.user.create({ data: { userCode: `TSTA-U-${sfx}`, email: `tsta_${sfx}@e.local`, passwordHash: 'x', firstName: 'Auth', lastName: 'Or', role: 'SUPERVISOR' } })
  const admin = await prisma.user.create({ data: { userCode: `TSTA-AD-${sfx}`, email: `tstaad_${sfx}@e.local`, passwordHash: 'x', firstName: 'Ad', lastName: 'Min', role: 'ADMIN' } })
  const other = await prisma.user.create({ data: { userCode: `TSTA-OT-${sfx}`, email: `tstaot_${sfx}@e.local`, passwordHash: 'x', firstName: 'Ot', lastName: 'Her', role: 'SUPERVISOR' } })
  id.author = author.id; id.admin = admin.id; id.other = other.id

  const project = await prisma.project.create({ data: { projectCode: `TSTA-P-${sfx}`, name: `Attach ${sfx}`, createdBy: author.id } })
  id.projectId = project.id
  const draft = await prisma.dailyReport.create({ data: { reportCode: `DRA-${sfx}`, projectId: project.id, authorId: author.id, reportDate: new Date('2026-08-01T00:00:00.000Z'), status: 'DRAFT' } })
  const approved = await prisma.dailyReport.create({ data: { reportCode: `DRB-${sfx}`, projectId: project.id, authorId: author.id, reportDate: new Date('2026-08-02T00:00:00.000Z'), status: 'APPROVED' } })
  id.reportDraft = draft.id; id.reportApproved = approved.id

  const mkDel = async (reportId: string, note: string) =>
    (await prisma.delivery.create({ data: { dailyReportId: reportId, supplierName: 'Gulf', deliveryNoteNumber: note, createdById: author.id, lines: { create: [] } } })).id
  id.delA = await mkDel(draft.id, 'DN-A')
  id.delB = await mkDel(draft.id, 'DN-B')
  id.delC = await mkDel(draft.id, 'DN-C')
  id.delX = await mkDel(draft.id, 'DN-X')
  id.delApproved = await mkDel(approved.id, 'DN-APP')

  // Only delA has an OPEN MISSING_ATTACHMENT alert.
  id.alertA = (await prisma.inventoryAlert.create({ data: { projectId: project.id, type: 'MISSING_ATTACHMENT', sourceRecordId: id.delA, status: 'OPEN' } })).id
})

afterAll(async () => {
  await prisma.inventoryAlert.deleteMany({ where: { projectId: id.projectId } })
  await prisma.dailyReport.deleteMany({ where: { id: { in: [id.reportDraft!, id.reportApproved!] } } })
  await prisma.project.deleteMany({ where: { id: id.projectId } })
  await prisma.user.deleteMany({ where: { id: { in: [id.author!, id.admin!, id.other!] } } })
  await prisma.$disconnect()
})

describe('attachment upload — permissions', () => {
  it('the report author can upload (201), sets attachmentUrl, and flips the OPEN alert to ACKNOWLEDGED', async () => {
    actAs(id.author!)
    const res = await uploadCall(id.delA!, fileReq())
    expect(res.status).toBe(200)
    const del = await prisma.delivery.findUnique({ where: { id: id.delA }, select: { attachmentUrl: true } })
    expect(del!.attachmentUrl).toContain('MOCKEDBLOB')
    const alert = await prisma.inventoryAlert.findUnique({ where: { id: id.alertA }, select: { status: true, acknowledgedById: true } })
    expect(alert!.status).toBe('ACKNOWLEDGED')
    expect(alert!.acknowledgedById).toBe(id.author)
  })

  it('an admin can upload (201)', async () => {
    actAs(id.admin!)
    expect((await uploadCall(id.delB!, fileReq())).status).toBe(200)
  })

  it('an unrelated supervisor is rejected (403)', async () => {
    actAs(id.other!)
    expect((await uploadCall(id.delX!, fileReq())).status).toBe(403)
  })

  it('upload succeeds on an APPROVED report (immutability exception)', async () => {
    actAs(id.author!)
    const res = await upload(fileReq() as never, { params: { id: id.reportApproved!, deliveryId: id.delApproved! } })
    expect(res.status).toBe(200)
  })

  it('a delivery with no alert uploads fine (no crash on zero alert rows)', async () => {
    actAs(id.author!)
    expect((await uploadCall(id.delC!, fileReq())).status).toBe(200)
  })
})

describe('attachment upload — validation', () => {
  it('rejects an unsupported file type (400)', async () => {
    actAs(id.author!)
    expect((await uploadCall(id.delX!, fileReq({ type: 'text/plain', name: 'note.txt' }))).status).toBe(400)
  })
  it('rejects an oversize file (400)', async () => {
    actAs(id.author!)
    expect((await uploadCall(id.delX!, fileReq({ size: 10 * 1024 * 1024 + 1 }))).status).toBe(400)
  })
})

describe('the money wall + private-URL confidentiality', () => {
  it('loadReportDeliveries never emits the raw attachment URL or any cost field', async () => {
    const deliveries = await loadReportDeliveries(id.reportDraft!)
    const serialized = JSON.stringify(deliveries).toLowerCase()
    expect(serialized).not.toContain('mockedblob') // the stored blob pathname
    expect(serialized).not.toContain('attachmenturl')
    for (const banned of ['rate', 'cost', 'value', 'price', 'bhd']) expect(serialized).not.toContain(banned)
    // The boolean flag IS present.
    expect(deliveries.find((d) => d.id === id.delA)!.hasAttachment).toBe(true)
  })

  it('the view endpoint returns a signed URL to a viewer and 404 when no attachment', async () => {
    actAs(id.author!)
    const ok = await view(new Request('http://test/x') as never, { params: { id: id.reportDraft!, deliveryId: id.delA! } })
    expect(ok.status).toBe(200)
    expect((await ok.json()).url).toContain('signed.example')
    const none = await view(new Request('http://test/x') as never, { params: { id: id.reportDraft!, deliveryId: id.delX! } })
    expect(none.status).toBe(404) // delX never got an attachment
  })
})
