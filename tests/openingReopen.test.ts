import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { PrismaClient } from '@prisma/client'

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/email/transport', () => ({ sendMail: vi.fn() }))

import { getServerSession } from 'next-auth'
import { POST as createOpening } from '@/app/api/projects/[id]/opening-report/route'
import { PATCH as saveReport } from '@/app/api/reports/[id]/route'
import { POST as submitReport } from '@/app/api/reports/[id]/submit/route'
import { POST as approveReport } from '@/app/api/reports/[id]/approve/route'
import { POST as reopenReport } from '@/app/api/reports/[id]/reopen/route'
import { loadProjectCostPerformance } from '@/lib/cost.server'

const prisma = new PrismaClient()
const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const ids: Record<string, string> = {}
const D = (s: string) => new Date(`${s}T00:00:00.000Z`)
const actAs = (userId: string) => vi.mocked(getServerSession).mockResolvedValue({ user: { id: userId } } as never)
const post = () => new NextRequest('http://test/api/x', { method: 'POST' })
const patch = (body: unknown) => new NextRequest('http://test/api/x', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

let seq = 0
async function makeProject(startDate: string) {
  const project = await prisma.project.create({ data: { projectCode: `TRO-P${seq++}-${sfx}`, name: `RO ${sfx}`, status: 'ACTIVE', startDate: D(startDate), createdBy: ids.adminId! } })
  const asset = await prisma.asset.create({ data: { projectId: project.id, name: 'A' } })
  const activity = await prisma.activity.create({
    data: {
      assetId: asset.id, name: 'Coat', unit: 'm2', boqQuantity: 100, billRate: 20, sortOrder: 0,
      subActivities: { create: [{ name: 'Coat', type: 'MEASURED', sortOrder: 0, manpowerBudget: { create: [{ laborCategoryId: ids.catId!, hoursPerUnit: 1, costRateAtPlacement: 10 }] }, materialBudget: { create: [{ materialId: ids.materialId!, qtyPerUnit: 0.5 }] } }] },
    },
    include: { subActivities: true },
  })
  return { projectId: project.id, activityId: activity.id, coatSub: activity.subActivities[0]!.id }
}
async function approvedOpening(p: { projectId: string; activityId: string; coatSub: string }, materialQty: number, labour: number) {
  actAs(ids.adminId!)
  const reportId = (await (await createOpening(post(), { params: { id: p.projectId } })).json()).report.id as string
  await saveReport(patch({ subActivities: [{ subActivityId: p.coatSub, quantityDone: 100, percentComplete: 0, materials: [{ materialId: ids.materialId, quantity: materialQty }] }], openingLabour: [{ activityId: p.activityId, cost: labour }] }), { params: { id: reportId } })
  await submitReport(post(), { params: { id: reportId } })
  await approveReport(post(), { params: { id: reportId } })
  return reportId
}
const consumptionCount = (reportId: string) => prisma.consumptionEntry.count({ where: { dailyReportId: reportId } })
async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, tries = 20): Promise<T> {
  let v = await fn()
  for (let i = 0; i < tries && !ok(v); i++) { await new Promise((r) => setTimeout(r, 25)); v = await fn() }
  return v
}

beforeAll(async () => {
  const admin = await prisma.user.create({ data: { userCode: `TRO-A-${sfx}`, email: `tro_a_${sfx}@e.local`, passwordHash: 'x', firstName: 'A', lastName: 'D', role: 'ADMIN', status: 'ACTIVE' } })
  const sup = await prisma.user.create({ data: { userCode: `TRO-S-${sfx}`, email: `tro_s_${sfx}@e.local`, passwordHash: 'x', firstName: 'S', lastName: 'U', role: 'SUPERVISOR', status: 'ACTIVE' } })
  const cat = await prisma.laborCategory.create({ data: { name: `Mason ${sfx}`, hourlyRate: 10 } })
  const material = await prisma.material.create({ data: { name: `Cement ${sfx}`, unit: 'bag', unitRate: 2 } })
  ids.adminId = admin.id; ids.supId = sup.id; ids.catId = cat.id; ids.materialId = material.id
})

afterAll(async () => {
  await prisma.dailyReport.deleteMany({ where: { OR: [{ project: { projectCode: { startsWith: `TRO-P` } } }, { reportCode: { startsWith: `TRO-` } }] } })
  const projFilter = { project: { projectCode: { startsWith: `TRO-P` } } }
  await prisma.valuation.deleteMany({ where: projFilter })
  await prisma.inventoryAlert.deleteMany({ where: projFilter })
  await prisma.consumptionEntry.deleteMany({ where: projFilter })
  await prisma.project.deleteMany({ where: { projectCode: { startsWith: `TRO-P` } } })
  await prisma.material.deleteMany({ where: { id: ids.materialId } })
  await prisma.laborCategory.deleteMany({ where: { id: ids.catId } })
  await prisma.user.deleteMany({ where: { id: { in: [ids.adminId, ids.supId].filter((x): x is string => Boolean(x)) } } })
  await prisma.$disconnect()
})

describe('opening re-open — gate', () => {
  it('rejects a NORMAL approved report first (isOpeningBalance check), 409', async () => {
    const p = await makeProject('2026-03-01')
    const normal = await prisma.dailyReport.create({ data: { reportCode: `TRO-N-${sfx}`, projectId: p.projectId, authorId: ids.adminId!, reportDate: D('2026-03-15'), status: 'APPROVED', isOpeningBalance: false } })
    actAs(ids.adminId!)
    const res = await reopenReport(post(), { params: { id: normal.id } })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/not an opening-balance report/i)
  })

  it('rejects a DRAFT or SUBMITTED opening report (nothing to re-open)', async () => {
    const p = await makeProject('2026-03-01')
    actAs(ids.adminId!)
    const reportId = (await (await createOpening(post(), { params: { id: p.projectId } })).json()).report.id as string
    expect((await reopenReport(post(), { params: { id: reportId } })).status).toBe(409) // DRAFT
    await saveReport(patch({ subActivities: [{ subActivityId: p.coatSub, quantityDone: 100, percentComplete: 0, materials: [] }], openingLabour: [] }), { params: { id: reportId } })
    await submitReport(post(), { params: { id: reportId } })
    const res = await reopenReport(post(), { params: { id: reportId } }) // SUBMITTED
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/not approved/i)
  })

  it('rejects when a valuation on the project is CERTIFIED, naming the reason', async () => {
    const p = await makeProject('2026-04-01')
    const reportId = await approvedOpening(p, 10, 100)
    await prisma.valuation.create({ data: { valuationCode: `TRO-V-${sfx}`, projectId: p.projectId, periodMonth: D('2026-04-01'), progressPct: 10, cumulativeMeasured: 100, cumulativeLumpsum: 0, grossAmount: 100, previousGross: 0, retentionHeld: 5, advanceRecovery: 0, netPayable: 95, status: 'CERTIFIED', certifiedAt: new Date(), createdBy: ids.adminId! } })
    actAs(ids.adminId!)
    const res = await reopenReport(post(), { params: { id: reportId } })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/certified/i)
  })

  it('rejects when an approved report is dated after the opening balance, naming the reason', async () => {
    const p = await makeProject('2026-05-01') // opening dated 2026-05-01
    const reportId = await approvedOpening(p, 10, 100)
    await prisma.dailyReport.create({ data: { reportCode: `TRO-L-${sfx}`, projectId: p.projectId, authorId: ids.supId!, reportDate: D('2026-05-10'), status: 'APPROVED', isOpeningBalance: false } })
    actAs(ids.adminId!)
    const res = await reopenReport(post(), { params: { id: reportId } })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/later report/i)
  })

  it('rejects a supervisor with 403', async () => {
    const p = await makeProject('2026-06-01')
    const reportId = await approvedOpening(p, 10, 100)
    actAs(ids.supId!)
    expect((await reopenReport(post(), { params: { id: reportId } })).status).toBe(403)
  })
})

describe('opening re-open — effect and clean re-approval', () => {
  it('returns an approved opening to DRAFT, clears review fields, and audits it', async () => {
    const p = await makeProject('2026-07-01')
    const reportId = await approvedOpening(p, 10, 100)
    actAs(ids.adminId!)
    expect((await reopenReport(post(), { params: { id: reportId } })).status).toBe(200)
    const after = await prisma.dailyReport.findUnique({ where: { id: reportId }, select: { status: true, submittedAt: true, reviewedById: true, reviewedAt: true, reviewNote: true } })
    expect(after).toMatchObject({ status: 'DRAFT', submittedAt: null, reviewedById: null, reviewedAt: null, reviewNote: null })
    const audit = await waitFor(() => prisma.auditLog.findFirst({ where: { action: 'OPENING_REPORT_REOPENED', entityId: reportId }, select: { metadata: true } }), (v) => v != null)
    expect(audit).not.toBeNull()
    expect(audit!.metadata).toMatchObject({ fromStatus: 'APPROVED' })
  })

  it('cleans snapshots + consumption so a reopen-edit-reapprove does not double-count', async () => {
    const p = await makeProject('2026-08-01')
    const reportId = await approvedOpening(p, 50, 1000)
    // After first approval: AC = opening labour 1000 + material 50×2 = 1100; consumption recorded.
    const ac1 = (await loadProjectCostPerformance(p.projectId))!.actualCost
    const c1 = await consumptionCount(reportId)
    expect(ac1).toBe(1100)
    expect(c1).toBeGreaterThan(0)

    actAs(ids.adminId!)
    expect((await reopenReport(post(), { params: { id: reportId } })).status).toBe(200)
    // Snapshots undone: consumption gone, material cost snapshot cleared, and the draft leaves AC at 0.
    expect(await consumptionCount(reportId)).toBe(0)
    const mat = await prisma.materialEntry.findFirst({ where: { reportSubActivity: { reportActivity: { reportId } } }, select: { costAtApproval: true } })
    expect(mat?.costAtApproval).toBeNull()
    expect((await loadProjectCostPerformance(p.projectId))!.actualCost).toBe(0)

    // Correct the figures and re-approve.
    await saveReport(patch({ subActivities: [{ subActivityId: p.coatSub, quantityDone: 100, percentComplete: 0, materials: [{ materialId: ids.materialId, quantity: 30 }] }], openingLabour: [{ activityId: p.activityId, cost: 600 }] }), { params: { id: reportId } })
    await submitReport(post(), { params: { id: reportId } })
    await approveReport(post(), { params: { id: reportId } })

    // AC reflects the NEW figures (600 + 30×2 = 660), not the old ones added on top; consumption
    // re-derived once, not doubled.
    expect((await loadProjectCostPerformance(p.projectId))!.actualCost).toBe(660)
    expect(await consumptionCount(reportId)).toBe(c1)
  })
})
