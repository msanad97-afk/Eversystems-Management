import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'

// Supplier catalogue: deactivation removes a supplier from the active-supplier list (the list
// that feeds the material dropdown), while the material link is preserved.
const prisma = new PrismaClient()
const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const ids: { supplierId?: string; materialId?: string } = {}

beforeAll(async () => {
  const supplier = await prisma.supplier.create({ data: { name: `Gulf Materials ${sfx}`, contactName: 'Sam' } })
  ids.supplierId = supplier.id
  const material = await prisma.material.create({ data: { name: `Cement ${sfx}`, unit: 'bags', supplierId: supplier.id } })
  ids.materialId = material.id
})

afterAll(async () => {
  if (ids.materialId) await prisma.material.deleteMany({ where: { id: ids.materialId } })
  if (ids.supplierId) await prisma.supplier.deleteMany({ where: { id: ids.supplierId } })
  await prisma.$disconnect()
})

async function activeSupplierIds() {
  const rows = await prisma.supplier.findMany({ where: { isActive: true }, select: { id: true } })
  return new Set(rows.map((r) => r.id))
}

describe('supplier deactivation', () => {
  it('an active supplier appears in the active-supplier list', async () => {
    expect((await activeSupplierIds()).has(ids.supplierId!)).toBe(true)
  })

  it('after deactivation it disappears from the active list but is still on record', async () => {
    await prisma.supplier.update({ where: { id: ids.supplierId! }, data: { isActive: false } })
    expect((await activeSupplierIds()).has(ids.supplierId!)).toBe(false)
    const all = await prisma.supplier.findMany({ where: { id: ids.supplierId } })
    expect(all.length).toBe(1)
    // The material keeps its link (deactivation is not deletion).
    const material = await prisma.material.findUnique({ where: { id: ids.materialId! }, select: { supplierId: true } })
    expect(material?.supplierId).toBe(ids.supplierId)
  })
})
