import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { loadProjectOverview } from '@/lib/projectOverview.server'

// DB-backed: the ONE overview loader — project money + a money-FREE asset→activity progress tree.
const prisma = new PrismaClient()
const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const CONTRACT = 77700 // derived = billRate 777 × boq 100; distinctive money marker
const ids: Record<string, string> = {}

beforeAll(async () => {
  const user = await prisma.user.create({ data: { userCode: `TPO-U-${sfx}`, email: `tpo_${sfx}@e.local`, passwordHash: 'x', firstName: 'O', lastName: 'V', role: 'ADMIN' } })
  ids.userId = user.id
  const cat = await prisma.laborCategory.create({ data: { name: `Mason ${sfx}`, hourlyRate: 10 } })
  const project = await prisma.project.create({ data: { projectCode: `TPO-P-${sfx}`, name: `Overview ${sfx}`, status: 'ACTIVE', createdBy: user.id } })
  ids.projectId = project.id

  const a1 = await prisma.asset.create({ data: { projectId: project.id, name: 'Tower A', ref: 'A', sortOrder: 0 } })
  await prisma.asset.create({ data: { projectId: project.id, name: 'Tower B (inactive)', isActive: false, sortOrder: 1 } }) // excluded

  // Blockwork (active): S1 measured (BV 2×100×10 = 2000) + Scaffold lumpsum (BV 1000). BAC 3000.
  await prisma.activity.create({
    data: {
      assetId: a1.id, name: 'Blockwork', ref: '3.1', unit: 'm2', boqQuantity: 100, billRate: 777, sortOrder: 0,
      subActivities: {
        create: [
          { name: 'S1', type: 'MEASURED', sortOrder: 0, manpowerBudget: { create: [{ laborCategoryId: cat.id, hoursPerUnit: 2, costRateAtPlacement: 10 }] } },
          { name: 'Scaffold', type: 'LUMPSUM', lumpsumBhd: 1000, sortOrder: 1 },
        ],
      },
    },
    include: { subActivities: true },
  }).then((act) => {
    ids.blockworkId = act.id
    ids.s1 = act.subActivities.find((s) => s.name === 'S1')!.id
    ids.scaffold = act.subActivities.find((s) => s.name === 'Scaffold')!.id
  })
  // An inactive activity under the same asset — excluded.
  await prisma.activity.create({ data: { assetId: a1.id, name: 'Old works', unit: 'm2', boqQuantity: 50, isActive: false, sortOrder: 1 } })

  // Approved report: S1 = 50 of 100 (50%), Scaffold 100%.
  await prisma.dailyReport.create({
    data: {
      reportCode: `TPO-DR-${sfx}`, projectId: project.id, authorId: user.id, reportDate: new Date('2026-06-15T00:00:00.000Z'), status: 'APPROVED',
      activities: { create: [{ activityId: ids.blockworkId, subActivities: { create: [
        { subActivityId: ids.s1, quantityDone: 50 },
        { subActivityId: ids.scaffold, percentComplete: 100 },
      ] } }] },
    },
  })
})

afterAll(async () => {
  await prisma.dailyReport.deleteMany({ where: { reportCode: { startsWith: `TPO-DR-${sfx}` } } })
  if (ids.projectId) await prisma.project.deleteMany({ where: { id: ids.projectId } }) // cascades assets→activities→subs
  await prisma.laborCategory.deleteMany({ where: { name: { startsWith: `Mason ${sfx}` } } })
  if (ids.userId) await prisma.user.deleteMany({ where: { id: ids.userId } })
  await prisma.$disconnect()
})

describe('loadProjectOverview', () => {
  it('returns project money and per-asset/activity progress with hand-computed figures', async () => {
    const o = (await loadProjectOverview(ids.projectId!))!
    expect(o).not.toBeNull()
    // Project money block.
    expect(o.project.contractValue).toBe(CONTRACT)
    expect(o.project.bac).toBe(3000) // 2000 measured BV + 1000 lumpsum BV
    expect(o.project.ev).toBe(2000) // S1 50% × 2000 = 1000 + Scaffold 100% × 1000 = 1000
    expect(o.project.valuePercent).toBeCloseTo(66.7, 1) // EV/BAC = 2000/3000
    // Weighted physical %: mean of the single active activity's 75%.
    expect(o.project.physicalPercent).toBeCloseTo(75, 1)
  })

  it('excludes inactive assets and activities', async () => {
    const o = (await loadProjectOverview(ids.projectId!))!
    expect(o.assets).toHaveLength(1) // Tower B inactive → excluded
    const asset = o.assets[0]!
    expect(asset.name).toBe('Tower A')
    expect(asset.ref).toBe('A')
    expect(asset.activities).toHaveLength(1) // Old works inactive → excluded
    expect(asset.activities[0]!.name).toBe('Blockwork')
  })

  it('reflects a lumpsum sub in physical % (7ae617d behaviour)', async () => {
    const o = (await loadProjectOverview(ids.projectId!))!
    // Blockwork: measured S1 at 50% + lumpsum Scaffold at 100%, equal weights → (50+100)/2 = 75.
    // Without counting the lumpsum it would read 50.
    expect(o.assets[0]!.activities[0]!.physicalPercent).toBeCloseTo(75, 1)
    expect(o.assets[0]!.physicalPercent).toBeCloseTo(75, 1) // asset % = mean of its activity %s
  })

  it('carries NO cost field anywhere in the assets/activities branch', async () => {
    const o = (await loadProjectOverview(ids.projectId!))!
    // The money lives ONLY on the project branch.
    expect(Object.keys(o.assets[0]!).sort()).toEqual(['activities', 'name', 'physicalPercent', 'ref'])
    expect(Object.keys(o.assets[0]!.activities[0]!).sort()).toEqual(['boqQuantity', 'name', 'physicalPercent', 'ref', 'unit'])
    const s = JSON.stringify(o.assets)
    // Cost-specific markers (bare 'ac'/'ev'/'cv' would collide with words like "activities").
    for (const token of ['bac', 'cpi', 'eac', 'vac', 'contractValue', 'BHD', 'cost', 'lumpsum', 'unitRate', 'hourlyRate', String(CONTRACT)]) {
      expect(s).not.toContain(token)
    }
    // …but the distinctive contract value IS present on the project branch.
    expect(JSON.stringify(o.project)).toContain(String(CONTRACT))
  })
})
