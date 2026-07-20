import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { snapshotCatalogActivity } from '@/lib/catalog/snapshot'
import { loadProjectMoney, repriceActivity } from '@/lib/money.server'

/**
 * ⭐ Phase 6A hero test — the COST-RATE freeze guarantee.
 *
 * Global resource rates (LaborCategory.hourlyRate / Material.unitRate) are shared across
 * every project, so they are snapshotted onto the placed budget rows at placement.
 * Editing a global rate must therefore leave an already-placed project's cost budget
 * byte-identical; only an explicit admin re-price may move it.
 */
const prisma = new PrismaClient()
const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const ids: { userId?: string; projectId?: string; catalogId?: string; activityId?: string; masonId?: string; cementId?: string } = {}

// Dedicated resources so we never disturb the shared demo catalog.
const MASON = `TestMason-${sfx}`
const CEMENT = `TestCement-${sfx}`
const CAT = `TestPriced-${sfx}`

async function bac(): Promise<number> {
  const m = await loadProjectMoney(ids.projectId!)
  return m!.bac
}

beforeAll(async () => {
  const mason = await prisma.laborCategory.create({ data: { name: MASON, hourlyRate: 2 } })
  const cement = await prisma.material.create({ data: { name: CEMENT, unit: 'bag', unitRate: 1.5 } })
  ids.masonId = mason.id
  ids.cementId = cement.id

  const user = await prisma.user.create({ data: { userCode: `TSTM-U-${sfx}`, email: `tstm_${sfx}@e.local`, passwordHash: 'x', firstName: 'M', lastName: 'N', role: 'ADMIN' } })
  ids.userId = user.id
  const project = await prisma.project.create({ data: { projectCode: `TSTM-P-${sfx}`, name: `Money ${sfx}`, status: 'ACTIVE', createdBy: user.id } })
  ids.projectId = project.id
  const asset = await prisma.asset.create({ data: { projectId: project.id, name: 'Villa A' } })

  // Template: 0.3 mason-hr/m2 + 0.5 bag/m2.
  const catalog = await prisma.catalogActivity.create({
    data: {
      name: CAT, type: 'MEASURED', unit: 'm2',
      subActivities: {
        create: [{
          name: 'Base coat', type: 'MEASURED', sortOrder: 0,
          manpowerRates: { create: [{ laborCategoryId: mason.id, hoursPerUnit: 0.3 }] },
          materialRates: { create: [{ materialId: cement.id, qtyPerUnit: 0.5 }] },
        }],
      },
    },
  })
  ids.catalogId = catalog.id

  // Place at 1000 m2 → freezes hourlyRate 2 and unitRate 1.5.
  const placed = await prisma.$transaction((tx) => snapshotCatalogActivity(tx, catalog.id, { assetId: asset.id, sortOrder: 0, boqQuantity: 1000 }))
  ids.activityId = placed.id
  await prisma.activity.update({ where: { id: placed.id }, data: { billRate: 5 } })
})

afterAll(async () => {
  if (ids.projectId) await prisma.project.deleteMany({ where: { id: ids.projectId } })
  await prisma.catalogActivity.deleteMany({ where: { name: CAT } })
  await prisma.laborCategory.deleteMany({ where: { name: MASON } })
  await prisma.material.deleteMany({ where: { name: CEMENT } })
  if (ids.userId) await prisma.user.deleteMany({ where: { id: ids.userId } })
  await prisma.$disconnect()
})

describe('cost-rate freeze', () => {
  it('prices the placed budget from the rates frozen at placement', async () => {
    // labour 0.3 × 1000 × 2 = 600; material 0.5 × 1000 × 1.5 = 750 → BAC 1350
    expect(await bac()).toBe(1350)
  })

  it('is UNCHANGED after the GLOBAL resource rates are edited', async () => {
    await prisma.laborCategory.update({ where: { id: ids.masonId! }, data: { hourlyRate: 99 } })
    await prisma.material.update({ where: { id: ids.cementId! }, data: { unitRate: 99 } })
    expect(await bac()).toBe(1350) // ← the guarantee
  })

  it('updates only on an explicit re-price, and records the old→new changes', async () => {
    const changes = await prisma.$transaction((tx) => repriceActivity(tx, ids.activityId!))
    expect(changes).toHaveLength(2)
    expect(changes.find((c) => c.kind === 'LABOUR')).toMatchObject({ from: 2, to: 99 })
    expect(changes.find((c) => c.kind === 'MATERIAL')).toMatchObject({ from: 1.5, to: 99 })
    // 0.3 × 1000 × 99 = 29,700; 0.5 × 1000 × 99 = 49,500 → 79,200
    expect(await bac()).toBe(79200)
  })
})
