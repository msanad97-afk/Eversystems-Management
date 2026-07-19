import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { snapshotCatalogActivity } from '@/lib/catalog/snapshot'
import { loadActivityBudget } from '@/lib/budget.server'

/**
 * The deep-copy freeze guarantee: placing a catalog activity copies its rates into
 * project-owned rows with NO foreign key back to the catalog, so editing OR deleting the
 * catalog activity afterward leaves the placed project budget completely unchanged.
 */
const prisma = new PrismaClient()
const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const ids: { userId?: string; projectId?: string; catalogId?: string; placedId?: string } = {}

async function placedBudget(id: string) {
  const b = await loadActivityBudget(id)
  if (!b) throw new Error('no budget')
  return {
    mason: b.totals.manpower.find((m) => m.laborCategoryName === 'Mason')?.hours ?? 0,
    cement: b.totals.materials.find((m) => m.materialName === 'OPC Cement')?.quantity ?? 0,
    lumpsum: b.totals.lumpsumBhd,
  }
}

beforeAll(async () => {
  const [mason, cement] = await Promise.all([
    prisma.laborCategory.findFirstOrThrow({ where: { name: 'Mason' } }),
    prisma.material.findFirstOrThrow({ where: { name: 'OPC Cement' } }),
  ])

  const user = await prisma.user.create({
    data: { userCode: `TSTC-U-${sfx}`, email: `tstc_${sfx}@e.local`, passwordHash: 'x', firstName: 'C', lastName: 'A', role: 'ADMIN' },
  })
  ids.userId = user.id
  const project = await prisma.project.create({ data: { projectCode: `TSTC-P-${sfx}`, name: `Cat ${sfx}`, status: 'ACTIVE', createdBy: user.id } })
  ids.projectId = project.id
  const asset = await prisma.asset.create({ data: { projectId: project.id, name: 'Villa A' } })

  const catalog = await prisma.catalogActivity.create({
    data: {
      name: `EIFS-${sfx}`,
      type: 'MEASURED',
      unit: 'm2',
      subActivities: {
        create: [
          {
            name: 'Base coat',
            type: 'MEASURED',
            sortOrder: 0,
            manpowerRates: { create: [{ laborCategoryId: mason.id, hoursPerUnit: 0.3 }] },
            materialRates: { create: [{ materialId: cement.id, qtyPerUnit: 0.5 }] },
          },
          { name: 'Scaffolding', type: 'LUMPSUM', lumpsumBhd: 2500, sortOrder: 1 },
        ],
      },
    },
  })
  ids.catalogId = catalog.id

  // Place it at 1000 m2.
  const placed = await prisma.$transaction((tx) =>
    snapshotCatalogActivity(tx, catalog.id, { assetId: asset.id, sortOrder: 0, boqQuantity: 1000 }),
  )
  ids.placedId = placed.id
})

afterAll(async () => {
  if (ids.projectId) await prisma.project.deleteMany({ where: { id: ids.projectId } })
  await prisma.catalogActivity.deleteMany({ where: { name: `EIFS-${sfx}` } })
  if (ids.userId) await prisma.user.deleteMany({ where: { id: ids.userId } })
  await prisma.$disconnect()
})

describe('catalog snapshot → budget', () => {
  it('derives the placed budget from the frozen rates × placed quantity', async () => {
    const b = await placedBudget(ids.placedId!)
    expect(b.mason).toBe(300) // 0.3 × 1000
    expect(b.cement).toBe(500) // 0.5 × 1000
    expect(b.lumpsum).toBe(2500)
  })

  it('is UNCHANGED after the catalog activity is EDITED', async () => {
    // Slam the catalog rates + lumpsum to absurd values.
    await prisma.catalogManpowerRate.updateMany({
      where: { catalogSubActivity: { catalogActivityId: ids.catalogId! } },
      data: { hoursPerUnit: 999 },
    })
    await prisma.catalogMaterialRate.updateMany({
      where: { catalogSubActivity: { catalogActivityId: ids.catalogId! } },
      data: { qtyPerUnit: 999 },
    })
    await prisma.catalogSubActivity.updateMany({
      where: { catalogActivityId: ids.catalogId!, type: 'LUMPSUM' },
      data: { lumpsumBhd: 99999 },
    })

    const b = await placedBudget(ids.placedId!)
    expect(b.mason).toBe(300)
    expect(b.cement).toBe(500)
    expect(b.lumpsum).toBe(2500)
  })

  it('is UNCHANGED after the catalog activity is DELETED, and its provenance link goes null', async () => {
    await prisma.catalogActivity.delete({ where: { id: ids.catalogId! } })

    const activity = await prisma.activity.findUnique({ where: { id: ids.placedId! }, select: { catalogActivityId: true } })
    expect(activity).not.toBeNull()
    expect(activity!.catalogActivityId).toBeNull() // SetNull provenance, budget rows intact

    const b = await placedBudget(ids.placedId!)
    expect(b.mason).toBe(300)
    expect(b.cement).toBe(500)
    expect(b.lumpsum).toBe(2500)
  })
})
