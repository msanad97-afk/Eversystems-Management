import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { PrismaClient } from '@prisma/client'

// Drive the REAL routes against the REAL DB: only next-auth is mocked (getSessionUser re-reads the
// user from prisma by id), and the mail transport is stubbed so nothing is sent.
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/email/transport', () => ({ sendMail: vi.fn() }))

import { getServerSession } from 'next-auth'
import { POST as createOpening } from '@/app/api/projects/[id]/opening-report/route'
import { PATCH as saveReport } from '@/app/api/reports/[id]/route'
import { POST as submitReport } from '@/app/api/reports/[id]/submit/route'
import { POST as approveReport } from '@/app/api/reports/[id]/approve/route'
import { loadProjectEvm } from '@/lib/evm.server'
import { loadProjectCostPerformance } from '@/lib/cost.server'
import { loadProjectOverview } from '@/lib/projectOverview.server'
import { expandActivityHundred } from '@/lib/reports/opening'

const prisma = new PrismaClient()
const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const ids: Record<string, string> = {}
const actAs = (userId: string) => vi.mocked(getServerSession).mockResolvedValue({ user: { id: userId } } as never)
const req = (body?: unknown) => new NextRequest('http://test/api/x', body === undefined ? { method: 'POST' } : { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

beforeAll(async () => {
  const admin = await prisma.user.create({ data: { userCode: `TOB-A-${sfx}`, email: `tob_a_${sfx}@e.local`, passwordHash: 'x', firstName: 'Ad', lastName: 'Min', role: 'ADMIN', status: 'ACTIVE' } })
  const supervisor = await prisma.user.create({ data: { userCode: `TOB-S-${sfx}`, email: `tob_s_${sfx}@e.local`, passwordHash: 'x', firstName: 'Su', lastName: 'Per', role: 'SUPERVISOR', status: 'ACTIVE' } })
  ids.adminId = admin.id; ids.supervisorId = supervisor.id

  const cat = await prisma.laborCategory.create({ data: { name: `Mason ${sfx}`, hourlyRate: 10 } })
  const material = await prisma.material.create({ data: { name: `Cement ${sfx}`, unit: 'bag', unitRate: 2 } })
  ids.materialId = material.id

  // Project WITH a start date + scope: Coat (measured, BV 1×100×10 = 1000) + Scaffold (lumpsum 500). BAC 1500.
  const project = await prisma.project.create({ data: { projectCode: `TOB-P-${sfx}`, name: `Opening ${sfx}`, status: 'ACTIVE', startDate: new Date('2026-01-01T00:00:00.000Z'), createdBy: admin.id } })
  ids.projectId = project.id
  const asset = await prisma.asset.create({ data: { projectId: project.id, name: 'Tower A', ref: 'A' } })
  const activity = await prisma.activity.create({
    data: {
      assetId: asset.id, name: 'Facade', ref: '3.1', unit: 'm2', boqQuantity: 100, billRate: 20, sortOrder: 0,
      subActivities: { create: [
        { name: 'Coat', type: 'MEASURED', sortOrder: 0, manpowerBudget: { create: [{ laborCategoryId: cat.id, hoursPerUnit: 1, costRateAtPlacement: 10 }] } },
        { name: 'Scaffold', type: 'LUMPSUM', lumpsumBhd: 500, sortOrder: 1 },
      ] },
    },
    include: { subActivities: true },
  })
  ids.activityId = activity.id
  ids.coatSub = activity.subActivities.find((s) => s.name === 'Coat')!.id
  ids.scaffoldSub = activity.subActivities.find((s) => s.name === 'Scaffold')!.id

  // Project WITHOUT a start date (for the null-date rejection).
  const noStart = await prisma.project.create({ data: { projectCode: `TOB-N-${sfx}`, name: `NoStart ${sfx}`, status: 'ACTIVE', createdBy: admin.id } })
  ids.noStartId = noStart.id
  const nAsset = await prisma.asset.create({ data: { projectId: noStart.id, name: 'B' } })
  await prisma.activity.create({ data: { assetId: nAsset.id, name: 'Earth', unit: 'm3', boqQuantity: 10, subActivities: { create: [{ name: 'Dig', type: 'MEASURED', sortOrder: 0 }] } } })
})

afterAll(async () => {
  await prisma.dailyReport.deleteMany({ where: { project: { projectCode: { startsWith: `TOB-` } } } })
  await prisma.project.deleteMany({ where: { projectCode: { startsWith: `TOB-` } } })
  await prisma.material.deleteMany({ where: { id: ids.materialId } })
  await prisma.laborCategory.deleteMany({ where: { name: { startsWith: `Mason ${sfx}` } } })
  await prisma.user.deleteMany({ where: { id: { in: [ids.adminId, ids.supervisorId].filter((x): x is string => Boolean(x)) } } })
  await prisma.$disconnect()
})

describe('opening-balance report — creation guards', () => {
  it('a supervisor cannot create one (403)', async () => {
    actAs(ids.supervisorId!)
    const res = await createOpening(req(), { params: { id: ids.projectId! } })
    expect(res.status).toBe(403)
  })

  it('a null start date is rejected with a clear message', async () => {
    actAs(ids.adminId!)
    const res = await createOpening(req(), { params: { id: ids.noStartId! } })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/start date/i)
  })

  it('creates a DRAFT opening report dated at the start date', async () => {
    actAs(ids.adminId!)
    const res = await createOpening(req(), { params: { id: ids.projectId! } })
    expect(res.status).toBe(201)
    ids.reportId = (await res.json()).report.id
    const row = await prisma.dailyReport.findUnique({ where: { id: ids.reportId }, select: { status: true, isOpeningBalance: true, reportDate: true, authorId: true } })
    expect(row?.status).toBe('DRAFT')
    expect(row?.isOpeningBalance).toBe(true)
    expect(row?.reportDate.toISOString().slice(0, 10)).toBe('2026-01-01')
  })

  it('rejects a second opening report for the same project (409)', async () => {
    actAs(ids.adminId!)
    const res = await createOpening(req(), { params: { id: ids.projectId! } })
    expect(res.status).toBe(409)
  })
})

describe('opening-balance report — entry, approval, effect', () => {
  it('the 100% shortcut expands to per-sub rows (measured→BOQ, lumpsum→100), not an activity record', () => {
    const rows = expandActivityHundred([
      { subActivityId: 'a', type: 'MEASURED', boqQuantity: 100 },
      { subActivityId: 'b', type: 'LUMPSUM', boqQuantity: 0 },
    ])
    expect(rows).toEqual([
      { subActivityId: 'a', quantityDone: 100, percentComplete: 0 },
      { subActivityId: 'b', quantityDone: 0, percentComplete: 100 },
    ])
  })

  it('saves progress + materials + opening labour, then submits and approves', async () => {
    actAs(ids.adminId!)
    const save = await saveReport(req({
      subActivities: [
        { subActivityId: ids.coatSub, quantityDone: 100, percentComplete: 0, materials: [{ materialId: ids.materialId, quantity: 50 }] },
        { subActivityId: ids.scaffoldSub, quantityDone: 0, percentComplete: 100 },
      ],
      openingLabour: [{ activityId: ids.activityId, cost: 800 }],
    }), { params: { id: ids.reportId! } })
    expect(save.status).toBe(200)

    // Stored uniformly as per-sub rows at 100%, with the activity carrying the opening labour cost.
    const ra = await prisma.reportActivity.findFirst({ where: { reportId: ids.reportId, activityId: ids.activityId }, select: { openingLabourCost: true, subActivities: { select: { subActivityId: true, quantityDone: true, percentComplete: true } } } })
    expect(Number(ra?.openingLabourCost)).toBe(800)
    expect(ra?.subActivities.find((s) => s.subActivityId === ids.coatSub)?.quantityDone && Number(ra.subActivities.find((s) => s.subActivityId === ids.coatSub)!.quantityDone)).toBe(100)
    expect(Number(ra?.subActivities.find((s) => s.subActivityId === ids.scaffoldSub)?.percentComplete)).toBe(100)

    expect((await submitReport(req(), { params: { id: ids.reportId! } })).status).toBe(200)
    expect((await approveReport(req(), { params: { id: ids.reportId! } })).status).toBe(200)
  })

  it('opening labour reaches AC and CPI, while man-hours do not rise', async () => {
    const [cost, evm] = await Promise.all([loadProjectCostPerformance(ids.projectId!), loadProjectEvm(ids.projectId!)])
    // Actual cost = opening labour 800 + material 50×2 = 900. EV = full BAC 1500 (both subs 100%).
    expect(cost!.openingLabourCost).toBe(800)
    expect(cost!.hasOpeningLabour).toBe(true)
    expect(cost!.actualCost).toBe(900)
    expect(evm!.ac).toBe(900)
    expect(evm!.ev).toBe(1500)
    expect(evm!.cpi).toBeCloseTo(1500 / 900, 2)
    // No man-hours: opening labour has no ManpowerEntry behind it.
    const manEntries = await prisma.manpowerEntry.count({ where: { reportSubActivity: { reportActivity: { reportId: ids.reportId } } } })
    expect(manEntries).toBe(0)
  })

  it('EVM, the matrix and inventory read it with no loader special-case', async () => {
    const overview = await loadProjectOverview(ids.projectId!)
    expect(overview!.project.physicalPercent).toBe(100) // matrix/progress see 100%
    const coatCell = overview!.matrix[0]!.rows[0]!.cells[overview!.matrix[0]!.columns.findIndex((c) => c.name === 'Coat')]
    expect(coatCell?.percent).toBe(100)
    // Inventory: the materials flowed through the ordinary consumption pipeline on submit.
    const matEntries = await prisma.materialEntry.count({ where: { reportSubActivity: { reportActivity: { reportId: ids.reportId } } } })
    expect(matEntries).toBe(1)
  })

  it('approval locks it — no edit path exists afterwards', async () => {
    actAs(ids.adminId!)
    const res = await saveReport(req({ subActivities: [], openingLabour: [] }), { params: { id: ids.reportId! } })
    expect(res.status).toBe(403)
  })
})
