import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { snapshotCatalogActivity } from '@/lib/catalog/snapshot'
import { loadDashboard } from '@/lib/dashboard.server'

// DB-backed: placement snapshots weightPct; editing a placed weight changes the activity's reported
// physical % (a weighted sum, not the old mean); a CERTIFIED valuation stays byte-for-byte frozen.
const prisma = new PrismaClient()
const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const ids: Record<string, string> = {}
const CERT = { progressPct: 40, cumulativeMeasured: 800, cumulativeLumpsum: 0, grossAmount: 800, previousGross: 0, retentionHeld: 40, advanceRecovery: 0, netPayable: 760 }

const worksPercent = async () => {
  const dash = await loadDashboard({ projectId: ids.projectId!, from: '2026-01-01', to: '2026-12-31' })
  const proj = dash.progress.find((p) => p.projectId === ids.projectId)
  const asset = proj?.assets.find((a) => a.assetId === ids.assetId)
  return asset?.activities.find((a) => a.activityId === ids.worksId)?.percent
}

beforeAll(async () => {
  const admin = await prisma.user.create({ data: { userCode: `TSW-A-${sfx}`, email: `tsw_${sfx}@e.local`, passwordHash: 'x', firstName: 'W', lastName: 'Admin', role: 'ADMIN' } })
  ids.adminId = admin.id
  const project = await prisma.project.create({ data: { projectCode: `TSW-P-${sfx}`, name: `Weight ${sfx}`, createdBy: admin.id } })
  ids.projectId = project.id
  const asset = await prisma.asset.create({ data: { projectId: project.id, name: 'Tower A' } })
  ids.assetId = asset.id

  // Catalogue activity with a weighted named sub, for the snapshot test.
  const cat = await prisma.catalogActivity.create({
    data: { name: `EIFS ${sfx}`, type: 'MEASURED', unit: 'm2', subActivities: { create: [{ name: 'First fix', type: 'MEASURED', sortOrder: 0, weightPct: 70 }] } },
    include: { subActivities: true },
  })
  ids.catId = cat.id
  ids.catSubId = cat.subActivities[0]!.id
  const placed = await prisma.$transaction((tx) => snapshotCatalogActivity(tx, cat.id, { assetId: asset.id, sortOrder: 0, boqQuantity: 100 }))
  ids.placedActivityId = placed.id

  // A measured activity with two equal (null-weight) subs; S1 fully done, S2 not started.
  const works = await prisma.activity.create({
    data: {
      assetId: asset.id, name: 'Works', type: 'MEASURED', unit: 'm2', boqQuantity: 100, sortOrder: 1,
      subActivities: { create: [{ name: 'S1', type: 'MEASURED', sortOrder: 0 }, { name: 'S2', type: 'MEASURED', sortOrder: 1 }] },
    },
    include: { subActivities: true },
  })
  ids.worksId = works.id
  ids.s1 = works.subActivities.find((s) => s.name === 'S1')!.id
  ids.s2 = works.subActivities.find((s) => s.name === 'S2')!.id

  await prisma.dailyReport.create({
    data: {
      reportCode: `TSW-DR-${sfx}`, projectId: project.id, authorId: admin.id, reportDate: new Date('2026-06-15T00:00:00.000Z'), status: 'APPROVED',
      activities: { create: [{ activityId: works.id, subActivities: { create: [{ subActivityId: ids.s1, quantityDone: 100 }] } }] }, // S1 = 100 of 100 → 100%
    },
  })

  const val = await prisma.valuation.create({
    data: { valuationCode: `TSW-VAL-${sfx}`, projectId: project.id, periodMonth: new Date('2026-06-01T00:00:00.000Z'), ...CERT, status: 'CERTIFIED', certifiedAt: new Date(), createdBy: admin.id },
  })
  ids.valuationId = val.id
})

afterAll(async () => {
  await prisma.dailyReport.deleteMany({ where: { reportCode: { startsWith: `TSW-DR-${sfx}` } } })
  if (ids.projectId) await prisma.valuation.deleteMany({ where: { projectId: ids.projectId } })
  if (ids.projectId) await prisma.project.deleteMany({ where: { id: ids.projectId } }) // cascades asset→activities→subs
  if (ids.catId) await prisma.catalogActivity.deleteMany({ where: { id: ids.catId } })
  if (ids.adminId) await prisma.user.deleteMany({ where: { id: ids.adminId } })
  await prisma.$disconnect()
})

describe('placement snapshots weightPct', () => {
  it('the placed sub carries the catalogue weight, and a later catalogue change does not alter it', async () => {
    const placedSub = await prisma.subActivity.findFirstOrThrow({ where: { activityId: ids.placedActivityId, name: 'First fix' }, select: { id: true, weightPct: true } })
    expect(Number(placedSub.weightPct)).toBe(70)

    await prisma.catalogSubActivity.update({ where: { id: ids.catSubId }, data: { weightPct: 10 } })
    const after = await prisma.subActivity.findUniqueOrThrow({ where: { id: placedSub.id }, select: { weightPct: true } })
    expect(Number(after.weightPct)).toBe(70) // frozen — not 10
  })
})

describe('weighted physical % + certified immutability', () => {
  it('null weights give the equal-split mean; editing a weight changes the reported % and never moves a certified valuation', async () => {
    // Both subs unweighted → equal split → (100 + 0) / 2 = 50 (no regression vs the old mean).
    expect(await worksPercent()).toBeCloseTo(50, 3)

    const certBefore = await prisma.valuation.findUniqueOrThrow({ where: { id: ids.valuationId }, select: { progressPct: true, cumulativeMeasured: true, grossAmount: true, retentionHeld: true, netPayable: true } })

    // Weight S1 70 / S2 30 → 100×0.7 + 0×0.3 = 70.
    await prisma.subActivity.update({ where: { id: ids.s1 }, data: { weightPct: 70 } })
    await prisma.subActivity.update({ where: { id: ids.s2 }, data: { weightPct: 30 } })
    expect(await worksPercent()).toBeCloseTo(70, 3)

    const certAfter = await prisma.valuation.findUniqueOrThrow({ where: { id: ids.valuationId }, select: { progressPct: true, cumulativeMeasured: true, grossAmount: true, retentionHeld: true, netPayable: true } })
    const num = (v: typeof certBefore) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Number(x)]))
    expect(num(certAfter)).toEqual(num(certBefore)) // byte-for-byte frozen
  })
})
