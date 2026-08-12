import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { syncMissingAttachmentAlerts } from '@/lib/deliveries/alerts.server'
import { loadReportDeliveries } from '@/lib/deliveries/deliveries.server'

// Deliveries on the daily report: MISSING_ATTACHMENT alert behaviour on submit + the money wall.
const prisma = new PrismaClient()
const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const ids: { userId?: string; projectId?: string; reportId?: string; materialId?: string; delNoAtt?: string; delWithAtt?: string } = {}

const SECRET_UNIT_RATE = 9.99 // Material.unitRate — must never reach a delivery view

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { userCode: `TSTD-U-${sfx}`, email: `tstd_${sfx}@e.local`, passwordHash: 'x', firstName: 'Del', lastName: 'Author', role: 'SUPERVISOR' },
  })
  ids.userId = user.id
  const project = await prisma.project.create({ data: { projectCode: `TSTD-P-${sfx}`, name: `Deliveries ${sfx}`, createdBy: user.id } })
  ids.projectId = project.id
  const material = await prisma.material.create({ data: { name: `Cement ${sfx}`, unit: 'bags', unitRate: SECRET_UNIT_RATE } })
  ids.materialId = material.id
  const report = await prisma.dailyReport.create({
    data: { reportCode: `DRD-${sfx}`, projectId: project.id, authorId: user.id, reportDate: new Date('2026-08-01T00:00:00.000Z'), status: 'DRAFT' },
  })
  ids.reportId = report.id

  const noAtt = await prisma.delivery.create({
    data: { dailyReportId: report.id, supplierName: 'Gulf Supplies', deliveryNoteNumber: 'DN-100', createdById: user.id, lines: { create: [{ materialId: material.id, quantity: 40, unit: 'bags' }] } },
  })
  ids.delNoAtt = noAtt.id
  const withAtt = await prisma.delivery.create({
    data: { dailyReportId: report.id, supplierName: 'Bahrain Cement', deliveryNoteNumber: 'DN-200', attachmentUrl: 'https://example/dn-200.pdf', createdById: user.id, lines: { create: [{ materialId: material.id, quantity: 25, unit: 'bags' }] } },
  })
  ids.delWithAtt = withAtt.id
})

afterAll(async () => {
  if (ids.projectId) await prisma.inventoryAlert.deleteMany({ where: { projectId: ids.projectId } })
  if (ids.reportId) await prisma.dailyReport.deleteMany({ where: { id: ids.reportId } }) // cascades deliveries + lines
  if (ids.materialId) await prisma.material.deleteMany({ where: { id: ids.materialId } })
  if (ids.projectId) await prisma.project.deleteMany({ where: { id: ids.projectId } })
  if (ids.userId) await prisma.user.deleteMany({ where: { id: ids.userId } })
  await prisma.$disconnect()
})

async function runSync() {
  return prisma.$transaction((tx) => syncMissingAttachmentAlerts(tx, ids.reportId!, ids.projectId!))
}

describe('MISSING_ATTACHMENT alerts on submit', () => {
  it('a delivery without an attachment produces exactly one MISSING_ATTACHMENT alert', async () => {
    const created = await runSync()
    expect(created).toBe(1)
    const alerts = await prisma.inventoryAlert.findMany({ where: { sourceRecordId: ids.delNoAtt, type: 'MISSING_ATTACHMENT' } })
    expect(alerts.length).toBe(1)
    expect(alerts[0]!.projectId).toBe(ids.projectId)
    expect(alerts[0]!.status).toBe('OPEN')
  })

  it('a delivery with an attachment produces no alert', async () => {
    const alerts = await prisma.inventoryAlert.findMany({ where: { sourceRecordId: ids.delWithAtt } })
    expect(alerts.length).toBe(0)
  })

  it('is idempotent — resubmitting does not duplicate the alert', async () => {
    const again = await runSync()
    expect(again).toBe(0)
    const alerts = await prisma.inventoryAlert.findMany({ where: { sourceRecordId: ids.delNoAtt, type: 'MISSING_ATTACHMENT' } })
    expect(alerts.length).toBe(1) // still exactly one
  })
})

describe('the money wall — no cost on a supervisor-facing delivery path', () => {
  it('loadReportDeliveries emits no rate/cost/value/price field or value', async () => {
    const deliveries = await loadReportDeliveries(ids.reportId!)
    expect(deliveries.length).toBe(2)
    const serialized = JSON.stringify(deliveries).toLowerCase()
    for (const banned of ['rate', 'cost', 'value', 'price', 'bhd', 'unitrate']) {
      expect(serialized).not.toContain(banned)
    }
    expect(serialized).not.toContain(String(SECRET_UNIT_RATE))
    // The quantities-only shape is intact.
    const d = deliveries.find((x) => x.id === ids.delNoAtt)!
    expect(d.lines[0]!.quantity).toBe(40)
    expect(d.lines[0]!.unit).toBe('bags')
    expect(d.hasAttachment).toBe(false)
  })
})
