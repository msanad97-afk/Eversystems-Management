import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

// DB-backed: deactivate / reactivate / delete a named sub-activity on a placed activity. Real
// prisma; only session + audit are stubbed so the real PATCH/DELETE handlers run.
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(), recordAuditLog: vi.fn() }))

import { getServerSession } from 'next-auth'
import { PrismaClient } from '@prisma/client'
import { PATCH, DELETE } from '@/app/api/activities/[id]/subactivities/[subId]/route'
import { loadProjectMoney } from '@/lib/money.server'
import { loadFormScope } from '@/lib/reports/progress'
import { loadProjectEvm } from '@/lib/evm.server'

const prisma = new PrismaClient()
const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const ids: Record<string, string> = {}

function actAs(userId: string) {
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: userId } } as never)
}
const patch = (activityId: string, subId: string, body: unknown) =>
  PATCH(new Request('http://test/x', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never, { params: { id: activityId, subId } })
const del = (activityId: string, subId: string) =>
  DELETE(new Request('http://test/x', { method: 'DELETE' }) as never, { params: { id: activityId, subId } })

const bac = async () => (await loadProjectMoney(ids.projectId!))!.bac
// Project Earned Value (EVM, cost basis) — Σ BV × %complete over all subs, incl. lumpsum.
const projectEV = async () => (await loadProjectEvm(ids.projectId!))!.ev
const formScopeSubIds = async () => {
  const scope = await loadFormScope(ids.projectId!)
  return new Set(scope.flatMap((a) => a.activities).flatMap((x) => x.subActivities).map((s) => s.id))
}

const CERT = { progressPct: 40, cumulativeMeasured: 800, cumulativeLumpsum: 500, grossAmount: 1300, previousGross: 0, retentionHeld: 65, advanceRecovery: 0, netPayable: 1235 }

beforeAll(async () => {
  const admin = await prisma.user.create({ data: { userCode: `TSL-A-${sfx}`, email: `tsl_a_${sfx}@e.local`, passwordHash: 'x', firstName: 'Ada', lastName: 'Admin', role: 'ADMIN' } })
  const sup = await prisma.user.create({ data: { userCode: `TSL-S-${sfx}`, email: `tsl_s_${sfx}@e.local`, passwordHash: 'x', firstName: 'Sam', lastName: 'Super', role: 'SUPERVISOR' } })
  ids.adminId = admin.id; ids.supId = sup.id

  const cat = await prisma.laborCategory.create({ data: { name: `Mason ${sfx}`, hourlyRate: 10 } })
  const mat = await prisma.material.create({ data: { name: `Adhesive ${sfx}`, unit: 'kg', unitRate: 5 } })
  ids.catId = cat.id; ids.matId = mat.id

  const project = await prisma.project.create({ data: { projectCode: `TSL-P-${sfx}`, name: `Life ${sfx}`, createdBy: admin.id } })
  ids.projectId = project.id
  const asset = await prisma.asset.create({ data: { projectId: project.id, name: 'Tower A' } })
  ids.assetId = asset.id

  // "Works": First fix (BV 3500) + Second fix (BV 3000) + Labour Subcontract (LUMPSUM 2000) +
  // Snagging & Reported (no budget → BV 0). BAC = 8500.
  const works = await prisma.activity.create({
    data: {
      assetId: asset.id, name: 'Works', type: 'MEASURED', unit: 'm2', boqQuantity: 100, sortOrder: 0,
      subActivities: { create: [
        { name: 'First fix', type: 'MEASURED', sortOrder: 0, manpowerBudget: { create: [{ laborCategoryId: cat.id, hoursPerUnit: 2, costRateAtPlacement: 10 }] }, materialBudget: { create: [{ materialId: mat.id, qtyPerUnit: 3, costRateAtPlacement: 5 }] } },
        { name: 'Second fix', type: 'MEASURED', sortOrder: 1, manpowerBudget: { create: [{ laborCategoryId: cat.id, hoursPerUnit: 1, costRateAtPlacement: 10 }] }, materialBudget: { create: [{ materialId: mat.id, qtyPerUnit: 4, costRateAtPlacement: 5 }] } },
        { name: 'Labour Subcontract', type: 'LUMPSUM', lumpsumBhd: 2000, sortOrder: 2 },
        { name: 'Snagging', type: 'MEASURED', sortOrder: 3 },
        { name: 'Reported', type: 'MEASURED', sortOrder: 4 },
      ] },
    },
    include: { subActivities: true },
  })
  ids.worksId = works.id
  const byName = (n: string) => works.subActivities.find((s) => s.name === n)!.id
  ids.s1 = byName('First fix'); ids.s2 = byName('Second fix'); ids.s3 = byName('Labour Subcontract'); ids.s4 = byName('Snagging'); ids.s5 = byName('Reported')

  // "Solo": exactly one named sub (last-active guard).
  const solo = await prisma.activity.create({
    data: { assetId: asset.id, name: 'Solo', type: 'MEASURED', unit: 'm2', boqQuantity: 50, sortOrder: 1, subActivities: { create: [{ name: 'Only', type: 'MEASURED' }] } },
    include: { subActivities: true },
  })
  ids.soloId = solo.id; ids.soloSub = solo.subActivities[0]!.id

  // "Flat": implicit-only (implicit guard).
  const flat = await prisma.activity.create({
    data: { assetId: asset.id, name: 'Flat', type: 'MEASURED', unit: 'm2', boqQuantity: 50, sortOrder: 2, subActivities: { create: [{ name: '__implicit__', type: 'MEASURED', isImplicit: true }] } },
    include: { subActivities: true },
  })
  ids.flatId = flat.id; ids.flatImplicitSub = flat.subActivities[0]!.id

  // Approved progress: lumpsum S3 at 50% (EV 1000); measured S5 reported (for delete-with-progress).
  await prisma.dailyReport.create({
    data: {
      reportCode: `TSL-DR-${sfx}`, projectId: project.id, authorId: admin.id, reportDate: new Date('2026-06-15T00:00:00.000Z'), status: 'APPROVED',
      activities: { create: [{ activityId: works.id, subActivities: { create: [
        { subActivityId: ids.s3, percentComplete: 50 },
        { subActivityId: ids.s5, quantityDone: 10 },
      ] } }] },
    },
  })

  // A CERTIFIED valuation with frozen figures — must be byte-identical after any deactivation.
  const val = await prisma.valuation.create({
    data: { valuationCode: `TSL-VAL-${sfx}`, projectId: project.id, periodMonth: new Date('2026-05-01T00:00:00.000Z'), ...CERT, status: 'CERTIFIED', certifiedAt: new Date('2026-05-31T00:00:00.000Z'), createdBy: admin.id },
  })
  ids.valuationId = val.id
})

afterAll(async () => {
  await prisma.dailyReport.deleteMany({ where: { reportCode: { startsWith: `TSL-DR-${sfx}` } } })
  if (ids.projectId) await prisma.valuation.deleteMany({ where: { projectId: ids.projectId } })
  if (ids.projectId) await prisma.project.deleteMany({ where: { id: ids.projectId } }) // cascades assets→activities→subs→budgets
  if (ids.matId) await prisma.material.deleteMany({ where: { id: ids.matId } })
  if (ids.catId) await prisma.laborCategory.deleteMany({ where: { id: ids.catId } })
  await prisma.user.deleteMany({ where: { id: { in: [ids.adminId, ids.supId].filter((x): x is string => Boolean(x)) } } })
  await prisma.$disconnect()
})

describe('guards (no mutation)', () => {
  it('a supervisor is rejected (403)', async () => {
    actAs(ids.supId!)
    expect((await patch(ids.worksId!, ids.s1!, { isActive: false })).status).toBe(403)
  })
  it('a subId not on the path activity → 404', async () => {
    actAs(ids.adminId!)
    expect((await patch(ids.soloId!, ids.s1!, { isActive: false })).status).toBe(404) // s1 belongs to Works
  })
  it('the implicit sub → 409', async () => {
    actAs(ids.adminId!)
    expect((await patch(ids.flatId!, ids.flatImplicitSub!, { isActive: false })).status).toBe(409)
  })
  it('the last active sub → 409', async () => {
    actAs(ids.adminId!)
    expect((await patch(ids.soloId!, ids.soloSub!, { isActive: false })).status).toBe(409)
    expect((await prisma.subActivity.findUniqueOrThrow({ where: { id: ids.soloSub }, select: { isActive: true } })).isActive).toBe(true)
  })
})

describe('deactivation drops BV from BAC and hides the sub from the report form', () => {
  it('deactivating Second fix removes its BV (3000) from BAC and drops it from loadFormScope', async () => {
    actAs(ids.adminId!)
    const before = await bac()
    const res = await patch(ids.worksId!, ids.s2!, { isActive: false })
    expect(res.status).toBe(200)
    const after = await bac()
    expect(before - after).toBeCloseTo(3000, 3)
    expect(await formScopeSubIds()).not.toContain(ids.s2) // no longer offered on new reports
    expect((await prisma.subActivity.findUniqueOrThrow({ where: { id: ids.s2 }, select: { isActive: true } })).isActive).toBe(false)
  })

  it('reactivating it restores BAC and the report-form line', async () => {
    actAs(ids.adminId!)
    const res = await patch(ids.worksId!, ids.s2!, { isActive: true })
    expect(res.status).toBe(200)
    expect(await bac()).toBeCloseTo(8500, 3)
    expect(await formScopeSubIds()).toContain(ids.s2)
  })
})

describe('lumpsum EV + certified immutability', () => {
  it('deactivating the reported LUMPSUM sub removes its EV from the live figure; the certified valuation is unchanged', async () => {
    actAs(ids.adminId!)
    const before = await projectEV()
    const certBefore = await prisma.valuation.findUniqueOrThrow({ where: { id: ids.valuationId }, select: { progressPct: true, cumulativeMeasured: true, cumulativeLumpsum: true, grossAmount: true, previousGross: true, retentionHeld: true, advanceRecovery: true, netPayable: true } })

    const res = await patch(ids.worksId!, ids.s3!, { isActive: false })
    expect(res.status).toBe(200)

    const after = await projectEV()
    expect(before - after).toBeCloseTo(1000, 3) // 50% × BHD 2000

    const certAfter = await prisma.valuation.findUniqueOrThrow({ where: { id: ids.valuationId }, select: { progressPct: true, cumulativeMeasured: true, cumulativeLumpsum: true, grossAmount: true, previousGross: true, retentionHeld: true, advanceRecovery: true, netPayable: true } })
    const num = (v: typeof certBefore) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Number(x)]))
    expect(num(certAfter)).toEqual(CERT)
    expect(num(certAfter)).toEqual(num(certBefore))
  })
})

describe('delete rule mirrors the activity DELETE', () => {
  it('DELETE a sub with reported progress deactivates it (rows survive)', async () => {
    actAs(ids.adminId!)
    const rowsBefore = await prisma.reportSubActivity.count({ where: { subActivityId: ids.s5 } })
    expect(rowsBefore).toBeGreaterThan(0)
    const res = await del(ids.worksId!, ids.s5!)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.deactivated).toBe(true)
    expect((await prisma.subActivity.findUniqueOrThrow({ where: { id: ids.s5 }, select: { isActive: true } })).isActive).toBe(false)
    expect(await prisma.reportSubActivity.count({ where: { subActivityId: ids.s5 } })).toBe(rowsBefore) // survived
  })

  it('DELETE a sub with no progress hard-deletes it', async () => {
    actAs(ids.adminId!)
    const res = await del(ids.worksId!, ids.s4!)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.deleted).toBe(true)
    expect(await prisma.subActivity.findUnique({ where: { id: ids.s4 } })).toBeNull()
  })
})
