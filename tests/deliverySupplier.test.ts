import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'

// Integration: real DB + mocked auth, exercising the delivery create route's supplier rules.
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(), recordAuditLog: vi.fn() }))

import { getServerSession } from 'next-auth'
import { POST as createDelivery } from '@/app/api/reports/[id]/deliveries/route'

const prisma = new PrismaClient()
const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const ids: { userId?: string; projectId?: string; reportId?: string; supA?: string; supB?: string; matA?: string; matB?: string; matNull?: string } = {}

const post = (body: unknown) =>
  createDelivery(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    new Request('http://test/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as any,
    { params: { id: ids.reportId! } },
  )

beforeAll(async () => {
  const user = await prisma.user.create({ data: { userCode: `TSTDS-U-${sfx}`, email: `tstds_${sfx}@e.local`, passwordHash: 'x', firstName: 'Sup', lastName: 'Visor', role: 'SUPERVISOR' } })
  ids.userId = user.id
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: user.id } } as never)

  const project = await prisma.project.create({ data: { projectCode: `TSTDS-P-${sfx}`, name: `Deliv ${sfx}`, createdBy: user.id } })
  ids.projectId = project.id
  const report = await prisma.dailyReport.create({ data: { reportCode: `DRDS-${sfx}`, projectId: project.id, authorId: user.id, reportDate: new Date('2026-08-01T00:00:00.000Z'), status: 'DRAFT' } })
  ids.reportId = report.id

  const supA = await prisma.supplier.create({ data: { name: `Supplier A ${sfx}` } })
  const supB = await prisma.supplier.create({ data: { name: `Supplier B ${sfx}` } })
  ids.supA = supA.id; ids.supB = supB.id
  ids.matA = (await prisma.material.create({ data: { name: `MatA ${sfx}`, unit: 'bags', supplierId: supA.id } })).id
  ids.matB = (await prisma.material.create({ data: { name: `MatB ${sfx}`, unit: 'm3', supplierId: supB.id } })).id
  ids.matNull = (await prisma.material.create({ data: { name: `MatNull ${sfx}`, unit: 'ea' } })).id
})

afterAll(async () => {
  if (ids.reportId) await prisma.dailyReport.deleteMany({ where: { id: ids.reportId } }) // cascades deliveries + lines
  await prisma.material.deleteMany({ where: { id: { in: [ids.matA!, ids.matB!, ids.matNull!] } } })
  await prisma.supplier.deleteMany({ where: { id: { in: [ids.supA!, ids.supB!] } } })
  if (ids.projectId) await prisma.project.deleteMany({ where: { id: ids.projectId } })
  if (ids.userId) await prisma.user.deleteMany({ where: { id: ids.userId } })
  await prisma.$disconnect()
})

describe('delivery create — supplier rules', () => {
  it('valid supplierId + matching material persists BOTH supplierId and a snapshotted supplierName', async () => {
    const res = await post({ supplierId: ids.supA, deliveryNoteNumber: 'DN-1', lines: [{ materialId: ids.matA, quantity: 12 }] })
    expect(res.status).toBe(201)
    const row = await prisma.delivery.findFirst({ where: { dailyReportId: ids.reportId, deliveryNoteNumber: 'DN-1' }, include: { lines: true } })
    expect(row!.supplierId).toBe(ids.supA)
    expect(row!.supplierName).toBe(`Supplier A ${sfx}`) // frozen snapshot
    expect(row!.lines[0]!.materialId).toBe(ids.matA)
    expect(row!.lines[0]!.unit).toBe('bags') // unit snapshot
  })

  it('rejects a material belonging to a different supplier (400)', async () => {
    const res = await post({ supplierId: ids.supA, deliveryNoteNumber: 'DN-2', lines: [{ materialId: ids.matB, quantity: 1 }] })
    expect(res.status).toBe(400)
  })

  it('rejects a material that has no supplier (400)', async () => {
    const res = await post({ supplierId: ids.supA, deliveryNoteNumber: 'DN-3', lines: [{ materialId: ids.matNull, quantity: 1 }] })
    expect(res.status).toBe(400)
  })

  it('rejects a missing or unknown supplierId (400)', async () => {
    expect((await post({ deliveryNoteNumber: 'DN-4', lines: [{ materialId: ids.matA, quantity: 1 }] })).status).toBe(400)
    expect((await post({ supplierId: 'does-not-exist', deliveryNoteNumber: 'DN-5', lines: [{ materialId: ids.matA, quantity: 1 }] })).status).toBe(400)
  })
})
