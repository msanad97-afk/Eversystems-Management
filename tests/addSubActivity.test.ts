import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

// DB-backed: adding a sub-activity to a placed activity. Real prisma; only the session + audit are
// stubbed so the real POST handler runs. Covers the freeze (costRateAtPlacement), the derived-at-
// read-time BAC/physical% effects, and the immutability of certified valuations + the baseline.
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(), recordAuditLog: vi.fn() }))

import { getServerSession } from 'next-auth'
import { PrismaClient } from '@prisma/client'
import { POST } from '@/app/api/activities/[id]/subactivities/route'
import { snapshotCatalogActivity } from '@/lib/catalog/snapshot'
import { loadProjectMoney } from '@/lib/money.server'
import { loadDashboard } from '@/lib/dashboard.server'

const prisma = new PrismaClient()
const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const ids: Record<string, string> = {}

function actAs(userId: string) {
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: userId } } as never)
}
const post = (activityId: string, body: unknown) =>
  POST(new Request('http://test/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never, { params: { id: activityId } })

// Frozen certified-valuation figures we assert are never moved by an add.
const CERT = { progressPct: 42, cumulativeMeasured: 1000, cumulativeLumpsum: 200, grossAmount: 1200, previousGross: 0, retentionHeld: 60, advanceRecovery: 0, netPayable: 1140 }

async function activityPercent(): Promise<number | undefined> {
  const dash = await loadDashboard({ projectId: ids.projectId!, from: '2026-01-01', to: '2026-12-31' })
  const proj = dash.progress.find((p) => p.projectId === ids.projectId)
  const asset = proj?.assets.find((a) => a.assetId === ids.assetId)
  return asset?.activities.find((a) => a.activityId === ids.activityId)?.percent
}

beforeAll(async () => {
  const admin = await prisma.user.create({ data: { userCode: `TSA-A-${sfx}`, email: `tsa_a_${sfx}@e.local`, passwordHash: 'x', firstName: 'Ada', lastName: 'Admin', role: 'ADMIN' } })
  const sup = await prisma.user.create({ data: { userCode: `TSA-S-${sfx}`, email: `tsa_s_${sfx}@e.local`, passwordHash: 'x', firstName: 'Sam', lastName: 'Super', role: 'SUPERVISOR' } })
  ids.adminId = admin.id; ids.supId = sup.id

  // Global resource rates (the source of costRateAtPlacement).
  const cat = await prisma.laborCategory.create({ data: { name: `Mason ${sfx}`, hourlyRate: 10 } })
  const mat = await prisma.material.create({ data: { name: `Adhesive ${sfx}`, unit: 'kg', unitRate: 5 } })
  ids.catId = cat.id; ids.matId = mat.id

  // Catalogue activity placed with ONE named sub "First fix". "Second fix" is added to the
  // template AFTER placement, so it is missing from the placed copy — the real scenario.
  const template = await prisma.catalogActivity.create({
    data: {
      name: `EIFS ${sfx}`, type: 'MEASURED', unit: 'm2',
      subActivities: { create: [{
        name: 'First fix', type: 'MEASURED', sortOrder: 0,
        manpowerRates: { create: [{ laborCategoryId: cat.id, hoursPerUnit: 2 }] },
        materialRates: { create: [{ materialId: mat.id, qtyPerUnit: 3 }] },
      }] },
    },
  })
  ids.templateId = template.id

  const project = await prisma.project.create({ data: { projectCode: `TSA-P-${sfx}`, name: `Add ${sfx}`, createdBy: admin.id } })
  ids.projectId = project.id
  const asset = await prisma.asset.create({ data: { projectId: project.id, name: 'Tower A' } })
  ids.assetId = asset.id

  const placedActivity = await prisma.$transaction((tx) => snapshotCatalogActivity(tx, template.id, { assetId: asset.id, sortOrder: 0, boqQuantity: 100 }))
  ids.activityId = placedActivity.id
  const sub1 = await prisma.subActivity.findFirstOrThrow({ where: { activityId: placedActivity.id, name: 'First fix' }, select: { id: true } })
  ids.sub1Id = sub1.id

  // "Second fix" added to the template after placement (hoursPerUnit 1, qtyPerUnit 4).
  const secondFix = await prisma.catalogSubActivity.create({
    data: {
      catalogActivityId: template.id, name: 'Second fix', type: 'MEASURED', sortOrder: 1,
      manpowerRates: { create: [{ laborCategoryId: cat.id, hoursPerUnit: 1 }] },
      materialRates: { create: [{ materialId: mat.id, qtyPerUnit: 4 }] },
    },
  })
  ids.secondFixCatSubId = secondFix.id

  // A DIFFERENT catalogue activity, whose sub is FOREIGN to the placed activity's template.
  const alien = await prisma.catalogActivity.create({
    data: { name: `Alien ${sfx}`, type: 'MEASURED', unit: 'm2', subActivities: { create: [{ name: 'Alien sub', type: 'MEASURED' }] } },
    include: { subActivities: true },
  })
  ids.alienCatSubId = alien.subActivities[0]!.id
  ids.alienCatId = alien.id

  // A flat (implicit-only) placed activity, for the 409 case.
  const flat = await prisma.activity.create({
    data: { assetId: asset.id, name: 'Flat line', type: 'MEASURED', unit: 'm2', boqQuantity: 50, sortOrder: 1, subActivities: { create: [{ name: '__implicit__', type: 'MEASURED', isImplicit: true }] } },
  })
  ids.flatActivityId = flat.id

  // Approved progress on sub1 → 50 of 100 = 50% (so the mean visibly halves when a 2nd sub joins).
  await prisma.dailyReport.create({
    data: {
      reportCode: `TSA-DR-${sfx}`, projectId: project.id, authorId: admin.id, reportDate: new Date('2026-06-01T00:00:00.000Z'), status: 'APPROVED',
      activities: { create: [{ activityId: placedActivity.id, subActivities: { create: [{ subActivityId: sub1.id, quantityDone: 50 }] } }] },
    },
  })

  // A CERTIFIED valuation with frozen stored figures — must be byte-identical after the add.
  const val = await prisma.valuation.create({
    data: {
      valuationCode: `TSA-VAL-${sfx}`, projectId: project.id, periodMonth: new Date('2026-06-01T00:00:00.000Z'),
      ...CERT, status: 'CERTIFIED', certifiedAt: new Date('2026-06-30T00:00:00.000Z'), createdBy: admin.id,
      lines: { create: [{ assetId: asset.id, assetName: 'Tower A', cumulativeMeasured: 1000, cumulativeLumpsum: 200, cumulativeGross: 1200 }] },
    },
  })
  ids.valuationId = val.id

  // Baseline rows — must be untouched.
  await prisma.baselinePeriod.createMany({
    data: [
      { projectId: project.id, periodMonth: new Date('2026-06-01T00:00:00.000Z'), cumPlannedPct: 30 },
      { projectId: project.id, periodMonth: new Date('2026-07-01T00:00:00.000Z'), cumPlannedPct: 60 },
    ],
  })
})

afterAll(async () => {
  await prisma.dailyReport.deleteMany({ where: { reportCode: { startsWith: `TSA-DR-${sfx}` } } })
  if (ids.projectId) await prisma.valuation.deleteMany({ where: { projectId: ids.projectId } })
  if (ids.projectId) await prisma.project.deleteMany({ where: { id: ids.projectId } }) // cascades assets→activities→subs→budgets + baseline
  await prisma.catalogActivity.deleteMany({ where: { id: { in: [ids.templateId, ids.alienCatId].filter((x): x is string => Boolean(x)) } } })
  if (ids.matId) await prisma.material.deleteMany({ where: { id: ids.matId } })
  if (ids.catId) await prisma.laborCategory.deleteMany({ where: { id: ids.catId } })
  await prisma.user.deleteMany({ where: { id: { in: [ids.adminId, ids.supId].filter((x): x is string => Boolean(x)) } } })
  await prisma.$disconnect()
})

describe('add sub-activity — guards (no mutation)', () => {
  it('a supervisor is rejected (403)', async () => {
    actAs(ids.supId!)
    const res = await post(ids.activityId!, { catalogSubActivityId: ids.secondFixCatSubId })
    expect(res.status).toBe(403)
  })

  it('a catalogSubActivityId from another template → 400', async () => {
    actAs(ids.adminId!)
    const res = await post(ids.activityId!, { catalogSubActivityId: ids.alienCatSubId })
    expect(res.status).toBe(400)
  })

  it('a duplicate name (already on the activity) → 409', async () => {
    actAs(ids.adminId!)
    // "First fix" is already placed; its catalogue sub belongs to the template but the name clashes.
    const catFirst = await prisma.catalogSubActivity.findFirstOrThrow({ where: { catalogActivityId: ids.templateId, name: 'First fix' }, select: { id: true } })
    const res = await post(ids.activityId!, { catalogSubActivityId: catFirst.id })
    expect(res.status).toBe(409)
  })

  it('an implicit-only (flat) activity → 409 and creates nothing', async () => {
    actAs(ids.adminId!)
    const before = await prisma.subActivity.count({ where: { activityId: ids.flatActivityId } })
    const res = await post(ids.flatActivityId!, { catalogSubActivityId: ids.secondFixCatSubId })
    expect(res.status).toBe(409)
    expect(await prisma.subActivity.count({ where: { activityId: ids.flatActivityId } })).toBe(before) // unchanged
  })
})

describe('add sub-activity — catalogue copy + read-time effects', () => {
  let bacBefore = 0, bacAfter = 0, pctBefore: number | undefined, pctAfter: number | undefined
  let status = 0

  beforeAll(async () => {
    actAs(ids.adminId!)
    bacBefore = (await loadProjectMoney(ids.projectId!))!.bac
    pctBefore = await activityPercent()

    const res = await post(ids.activityId!, { catalogSubActivityId: ids.secondFixCatSubId })
    status = res.status
    const body = (await res.json()) as { subActivity?: { id: string } }
    ids.sub2Id = body.subActivity!.id

    bacAfter = (await loadProjectMoney(ids.projectId!))!.bac
    pctAfter = await activityPercent()
  })

  it('copies the sub and stamps costRateAtPlacement from the CURRENT global rates', async () => {
    expect(status).toBe(201)
    const man = await prisma.subActivityManpowerBudget.findFirstOrThrow({ where: { subActivityId: ids.sub2Id, laborCategoryId: ids.catId } })
    const mat = await prisma.subActivityMaterialBudget.findFirstOrThrow({ where: { subActivityId: ids.sub2Id, materialId: ids.matId } })
    expect(Number(man.hoursPerUnit)).toBe(1)
    expect(Number(mat.qtyPerUnit)).toBe(4)
    // The whole point: rates frozen, non-null, equal to the global rate at creation.
    expect(man.costRateAtPlacement).not.toBeNull()
    expect(Number(man.costRateAtPlacement)).toBe(10)
    expect(mat.costRateAtPlacement).not.toBeNull()
    expect(Number(mat.costRateAtPlacement)).toBe(5)
  })

  it('BAC increases by exactly the new sub-activity contribution', () => {
    // (1 h/unit × 10 + 4 qty/unit × 5) × 100 BOQ = 3000.
    expect(bacAfter - bacBefore).toBeCloseTo(3000, 3)
  })

  it("the activity's physical % falls as the mean gains a zero-progress sub (50 → 25)", () => {
    expect(pctBefore).toBeCloseTo(50, 3)
    expect(pctAfter).toBeCloseTo(25, 3)
  })

  it('a later change to the global rate does NOT alter the stamped value', async () => {
    await prisma.laborCategory.update({ where: { id: ids.catId }, data: { hourlyRate: 99 } })
    await prisma.material.update({ where: { id: ids.matId }, data: { unitRate: 99 } })
    const man = await prisma.subActivityManpowerBudget.findFirstOrThrow({ where: { subActivityId: ids.sub2Id, laborCategoryId: ids.catId } })
    const mat = await prisma.subActivityMaterialBudget.findFirstOrThrow({ where: { subActivityId: ids.sub2Id, materialId: ids.matId } })
    expect(Number(man.costRateAtPlacement)).toBe(10) // frozen — not 99
    expect(Number(mat.costRateAtPlacement)).toBe(5)
  })

  it('the already-CERTIFIED valuation stored figures are unchanged', async () => {
    const v = await prisma.valuation.findUniqueOrThrow({ where: { id: ids.valuationId }, select: { progressPct: true, cumulativeMeasured: true, cumulativeLumpsum: true, grossAmount: true, previousGross: true, retentionHeld: true, advanceRecovery: true, netPayable: true } })
    expect({
      progressPct: Number(v.progressPct), cumulativeMeasured: Number(v.cumulativeMeasured), cumulativeLumpsum: Number(v.cumulativeLumpsum),
      grossAmount: Number(v.grossAmount), previousGross: Number(v.previousGross), retentionHeld: Number(v.retentionHeld),
      advanceRecovery: Number(v.advanceRecovery), netPayable: Number(v.netPayable),
    }).toEqual(CERT)
  })

  it('BaselinePeriod rows are untouched', async () => {
    const rows = await prisma.baselinePeriod.findMany({ where: { projectId: ids.projectId }, orderBy: { periodMonth: 'asc' }, select: { cumPlannedPct: true } })
    expect(rows.map((r) => Number(r.cumPlannedPct))).toEqual([30, 60])
  })
})
