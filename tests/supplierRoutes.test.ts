import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(), recordAuditLog: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    supplier: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), update: vi.fn(), delete: vi.fn().mockResolvedValue({}) },
    material: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { GET as suppliersGet, POST as suppliersPost, PATCH as suppliersPatch, DELETE as suppliersDelete } from '@/app/api/catalogs/suppliers/route'
import { GET as materialsGet } from '@/app/api/catalogs/materials/route'

const USER_ID = 'user-1'
function actAs(role: Role) {
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: USER_ID } } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    id: USER_ID, email: 'u@e.local', userCode: 'USR-1', firstName: 'U', lastName: 'One', role, status: 'ACTIVE', mustChangePassword: false,
  } as never)
}
const nreq = (method: string, body?: unknown) =>
  new NextRequest('http://test/x', { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

beforeEach(() => vi.clearAllMocks())

describe('supplier endpoints are ADMIN-only', () => {
  it('rejects a SUPERVISOR on every method (403)', async () => {
    actAs('SUPERVISOR')
    expect((await suppliersGet(nreq('GET'))).status).toBe(403)
    expect((await suppliersPost(nreq('POST', { name: 'X' }))).status).toBe(403)
    expect((await suppliersPatch(nreq('PATCH', { id: 's1', name: 'X' }))).status).toBe(403)
    expect((await suppliersDelete(nreq('DELETE', { id: 's1' }))).status).toBe(403)
  })
})

describe('supplier deletion vs deactivation', () => {
  it('refuses to delete a supplier that has materials attached (409)', async () => {
    actAs('ADMIN')
    vi.mocked(prisma.supplier.findUnique).mockResolvedValue({ id: 's1', name: 'Gulf', _count: { materials: 2 } } as never)
    const res = await suppliersDelete(nreq('DELETE', { id: 's1' }))
    expect(res.status).toBe(409)
    expect(vi.mocked(prisma.supplier.delete)).not.toHaveBeenCalled()
  })

  it('deactivating a supplier succeeds (200, isActive false)', async () => {
    actAs('ADMIN')
    vi.mocked(prisma.supplier.findUnique).mockResolvedValue({ id: 's1', name: 'Gulf' } as never)
    vi.mocked(prisma.supplier.update).mockResolvedValue({
      id: 's1', name: 'Gulf', contactName: null, contactPhone: null, contactEmail: null, isActive: false, createdAt: new Date(), _count: { materials: 0 },
    } as never)
    const res = await suppliersPatch(nreq('PATCH', { id: 's1', isActive: false }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.supplier.isActive).toBe(false)
  })
})

describe('the money wall — supervisor material serializer', () => {
  it('emits no supplier link or cost field to a supervisor', async () => {
    actAs('SUPERVISOR')
    vi.mocked(prisma.material.findMany).mockResolvedValue([
      { id: 'm1', name: 'Cement', unit: 'bags', isActive: true, sortOrder: 0, unitRate: 5, supplierId: 's1', supplier: { name: 'Gulf' } },
    ] as never)
    const res = await materialsGet(nreq('GET'))
    expect(res.status).toBe(200)
    const json = await res.json()
    const m = json.materials[0]
    expect(m).not.toHaveProperty('unitRate')
    expect(m).not.toHaveProperty('supplierId')
    expect(m).not.toHaveProperty('supplierName')
    expect(m).not.toHaveProperty('supplier')
    expect(JSON.stringify(json).toLowerCase()).not.toContain('rate')
  })
})
