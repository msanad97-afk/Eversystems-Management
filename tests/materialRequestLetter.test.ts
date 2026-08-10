import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { loadMaterialRequestLetter } from '@/lib/materialRequests/letter.server'
import { renderMaterialRequestPdf } from '@/lib/pdf/render'

// The printed procurement letter must show APPROVED quantities only and carry NO cost — the
// supervisor prints and handles it, so the money wall holds inside the document too.
const prisma = new PrismaClient()
const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const ids: { userId?: string; projectId?: string; reviewedId?: string; draftId?: string; materialIds: string[] } = { materialIds: [] }

const SECRET_UNIT_RATE = 7.77 // Material.unitRate — must never reach the letter

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { userCode: `TSTL-U-${sfx}`, email: `tstl_${sfx}@e.local`, passwordHash: 'x', firstName: 'Lettie', lastName: 'Author', role: 'SUPERVISOR' },
  })
  ids.userId = user.id
  const admin = await prisma.user.create({
    data: { userCode: `TSTL-A-${sfx}`, email: `tstla_${sfx}@e.local`, passwordHash: 'x', firstName: 'Adam', lastName: 'Admin', role: 'ADMIN' },
  })
  const project = await prisma.project.create({ data: { projectCode: `TSTL-P-${sfx}`, name: `Letter ${sfx}`, createdBy: user.id } })
  ids.projectId = project.id
  const asset = await prisma.asset.create({ data: { projectId: project.id, name: 'Tower B' } })
  const activity = await prisma.activity.create({ data: { assetId: asset.id, name: 'Blockwork', unit: 'm2', boqQuantity: 100 } })

  const mkMat = async (name: string) => {
    const m = await prisma.material.create({ data: { name: `${name} ${sfx}`, unit: 'bags', unitRate: SECRET_UNIT_RATE } })
    ids.materialIds.push(m.id)
    return m.id
  }
  const a = await mkMat('Cement')
  const b = await mkMat('Rebar')
  const c = await mkMat('Sand')

  // PARTIALLY_APPROVED, scoped to asset + activity: modified (80 of 100), full (50), rejected (0).
  const reviewed = await prisma.materialRequest.create({
    data: {
      requestCode: `MRTL-${sfx}-1`, projectId: project.id, assetId: asset.id, activityId: activity.id,
      requestedById: user.id, reviewedById: admin.id, reviewedAt: new Date('2026-08-05T09:00:00.000Z'),
      reviewNote: 'Approved with adjustments.', status: 'PARTIALLY_APPROVED', submittedAt: new Date(),
      lines: {
        create: [
          { materialId: a, unit: 'bags', requestedQty: 100, approvedQty: 80, sortOrder: 0 },
          { materialId: b, unit: 'bags', requestedQty: 50, approvedQty: 50, sortOrder: 1 },
          { materialId: c, unit: 'bags', requestedQty: 10, approvedQty: 0, sortOrder: 2 },
        ],
      },
    },
  })
  ids.reviewedId = reviewed.id

  const draft = await prisma.materialRequest.create({
    data: { requestCode: `MRTL-${sfx}-2`, projectId: project.id, requestedById: user.id, status: 'DRAFT', lines: { create: [{ materialId: a, unit: 'bags', requestedQty: 5, sortOrder: 0 }] } },
  })
  ids.draftId = draft.id
})

afterAll(async () => {
  await prisma.materialRequest.deleteMany({ where: { requestCode: { startsWith: `MRTL-${sfx}` } } })
  if (ids.projectId) await prisma.project.deleteMany({ where: { id: ids.projectId } })
  if (ids.materialIds.length) await prisma.material.deleteMany({ where: { id: { in: ids.materialIds } } })
  await prisma.user.deleteMany({ where: { userCode: { startsWith: `TSTL-` }, email: { contains: sfx } } })
  await prisma.$disconnect()
})

describe('material-request letter data', () => {
  it('shows APPROVED quantities (not requested), omits rejected lines', async () => {
    const letter = await loadMaterialRequestLetter(ids.reviewedId!)
    expect(letter).not.toBeNull()
    const { data } = letter!
    expect(data.statusLabel).toBe('Partially Approved')
    // Rejected (0) line dropped → 2 lines; quantities are approved, not requested.
    expect(data.lines.length).toBe(2)
    const cement = data.lines.find((l) => l.materialName.startsWith('Cement'))!
    expect(cement.approvedQty).toBe(80) // approved, NOT the requested 100
    expect(data.lines.map((l) => l.approvedQty).sort((x, y) => x - y)).toEqual([50, 80])
    expect(data.scope.project).toContain('Letter')
    expect(data.scope.asset).toBe('Tower B')
    expect(data.scope.activity).toBe('Blockwork')
  })

  it('is not printable while unreviewed (draft → null)', async () => {
    expect(await loadMaterialRequestLetter(ids.draftId!)).toBeNull()
  })

  it('carries NO cost field or value anywhere in the letter data', async () => {
    const letter = await loadMaterialRequestLetter(ids.reviewedId!)
    const serialized = JSON.stringify(letter!.data)
    expect(serialized).not.toContain('unitRate')
    expect(serialized).not.toContain('costRateAtPlacement')
    expect(serialized).not.toContain('BHD')
    expect(serialized).not.toContain(String(SECRET_UNIT_RATE))
  })

  it('renders to a valid PDF buffer via the shared machinery', async () => {
    const letter = await loadMaterialRequestLetter(ids.reviewedId!)
    const buf = await renderMaterialRequestPdf(letter!.data)
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBeGreaterThan(1000)
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })
})
