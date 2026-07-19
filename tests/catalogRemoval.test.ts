import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'

// Real prisma + real route handlers; only auth and audit are stubbed so we exercise the
// actual create / list / delete logic against the dev DB.
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(), recordAuditLog: vi.fn() }))
vi.mock('@/lib/auth/permissions', () => {
  const guard = { user: { id: 'test-admin', email: 'a@e.local', userCode: 'X', firstName: 'A', lastName: 'D', role: 'ADMIN', status: 'ACTIVE', mustChangePassword: false } }
  return { requireAdmin: vi.fn().mockResolvedValue(guard), requireUser: vi.fn().mockResolvedValue(guard), requireRole: vi.fn().mockResolvedValue(guard) }
})

import { prisma } from '@/lib/prisma'
import { GET as listMaterials, POST as postMaterial, DELETE as deleteMaterial } from '@/app/api/catalogs/materials/route'
import { POST as postLabor, DELETE as deleteLabor } from '@/app/api/catalogs/labor/route'

const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const MAT = `TestMat-${sfx}`
const MAT_REF = `TestMatRef-${sfx}`
const LAB = `TestLab-${sfx}`
const LAB_REF = `TestLabRef-${sfx}`
const CAT = `TestCat-${sfx}`

const jreq = (url: string, method: string, body?: unknown) =>
  new NextRequest(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const matUrl = 'http://test/api/catalogs/materials'
const labUrl = 'http://test/api/catalogs/labor'

afterAll(async () => {
  await prisma.catalogActivity.deleteMany({ where: { name: CAT } })
  await prisma.material.deleteMany({ where: { name: { in: [MAT, MAT_REF] } } })
  await prisma.laborCategory.deleteMany({ where: { name: { in: [LAB, LAB_REF] } } })
  await prisma.$disconnect()
})

describe('material add is persisted and listed (the reported bug)', () => {
  beforeAll(async () => {
    await postMaterial(jreq(matUrl, 'POST', { name: MAT, unit: 'bag' }))
  })
  it('a created material is returned by the list endpoint', async () => {
    const data = await (await listMaterials(jreq(matUrl, 'GET'))).json()
    expect(data.materials.some((m: { name: string }) => m.name === MAT)).toBe(true)
  })
})

describe('material removal — safe delete vs deactivate', () => {
  it('hard-deletes a material that has never been used', async () => {
    const m = (await (await postMaterial(jreq(matUrl, 'POST', { name: `${MAT}-x`, unit: 'kg' }))).json()).material
    const res = await deleteMaterial(jreq(matUrl, 'DELETE', { id: m.id }))
    const data = await res.json()
    expect(data.deleted).toBe(true)
    expect(await prisma.material.findUnique({ where: { id: m.id } })).toBeNull()
  })

  it('deactivates (not deletes) a material referenced by a catalog rate line', async () => {
    const m = (await (await postMaterial(jreq(matUrl, 'POST', { name: MAT_REF, unit: 'kg' }))).json()).material
    // Reference it from a catalog activity budget rate line.
    await prisma.catalogActivity.create({
      data: {
        name: CAT, type: 'MEASURED', unit: 'm2',
        subActivities: { create: [{ name: 'S', type: 'MEASURED', materialRates: { create: [{ materialId: m.id, qtyPerUnit: 5 }] } }] },
      },
    })
    const data = await (await deleteMaterial(jreq(matUrl, 'DELETE', { id: m.id }))).json()
    expect(data.deactivated).toBe(true)
    expect(data.deleted).toBeFalsy()
    const still = await prisma.material.findUnique({ where: { id: m.id } })
    expect(still).not.toBeNull()
    expect(still!.isActive).toBe(false)
  })
})

describe('labour category removal — safe delete vs deactivate', () => {
  it('hard-deletes an unused labour category', async () => {
    const c = (await (await postLabor(jreq(labUrl, 'POST', { name: LAB }))).json()).category
    const data = await (await deleteLabor(jreq(labUrl, 'DELETE', { id: c.id }))).json()
    expect(data.deleted).toBe(true)
    expect(await prisma.laborCategory.findUnique({ where: { id: c.id } })).toBeNull()
  })

  it('deactivates a labour category referenced by a catalog rate line', async () => {
    const c = (await (await postLabor(jreq(labUrl, 'POST', { name: LAB_REF }))).json()).category
    await prisma.catalogActivity.update({
      where: { name: CAT },
      data: { subActivities: { create: [{ name: 'S2', type: 'MEASURED', manpowerRates: { create: [{ laborCategoryId: c.id, hoursPerUnit: 0.3 }] } }] } },
    })
    const data = await (await deleteLabor(jreq(labUrl, 'DELETE', { id: c.id }))).json()
    expect(data.deactivated).toBe(true)
    const still = await prisma.laborCategory.findUnique({ where: { id: c.id } })
    expect(still!.isActive).toBe(false)
  })
})
