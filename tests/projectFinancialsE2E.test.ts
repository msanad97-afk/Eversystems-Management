import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PrismaClient } from '@prisma/client'

/**
 * Phase 6E-pre end-to-end, against a real database. The whole point of the phase: header
 * financials set THROUGH the project route must reach the 6D valuation engine. Auth is mocked
 * (ADMIN) and audit is a no-op, but prisma is REAL — the routes and the valuation engine hit
 * the same database, so this proves the wiring, not a mock.
 */
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(), recordAuditLog: vi.fn() }))

import { getServerSession } from 'next-auth'
import { PATCH as patchProject } from '@/app/api/projects/[id]/route'
import { POST as certifyValuation } from '@/app/api/projects/[id]/valuations/[vid]/certify/route'
import { computeValuation, computationToHeader, computationToLines } from '@/lib/valuation.server'

const prisma = new PrismaClient()
const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const LABOUR = `PfeLabour-${sfx}`
const ids: Record<string, string> = {}

const patchReq = (body: unknown) =>
  new NextRequest('http://test/api/x', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

beforeAll(async () => {
  const labour = await prisma.laborCategory.create({ data: { name: LABOUR, hourlyRate: 1 } })
  const admin = await prisma.user.create({
    data: { userCode: `PFE-U-${sfx}`, email: `pfe_${sfx}@e.local`, passwordHash: 'x', firstName: 'A', lastName: 'D', role: 'ADMIN', status: 'ACTIVE' },
  })
  ids.userId = admin.id
  // requireAdmin() resolves the session id against the real user row.
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: admin.id } } as never)

  // A project created WITHOUT any commercial terms — the pre-phase default state.
  const project = await prisma.project.create({
    data: { projectCode: `PFE-P-${sfx}`, name: `Fin ${sfx}`, status: 'ACTIVE', createdBy: admin.id },
  })
  ids.projectId = project.id

  const asset = await prisma.asset.create({ data: { projectId: project.id, name: 'Block A', lumpsumRevenue: 4000 } })
  const measured = await prisma.activity.create({
    data: {
      assetId: asset.id, name: 'Blockwork', type: 'MEASURED', unit: 'm2', boqQuantity: 100, billRate: 10,
      subActivities: { create: [{ name: '__implicit__', type: 'MEASURED', isImplicit: true, manpowerBudget: { create: [{ laborCategoryId: labour.id, hoursPerUnit: 1, costRateAtPlacement: 1 }] } }] },
    },
    include: { subActivities: true },
  })
  ids.measuredSub = measured.subActivities[0]!.id
  const lumpsum = await prisma.activity.create({
    data: {
      assetId: asset.id, name: 'Waterproofing', type: 'LUMPSUM', boqQuantity: 0,
      subActivities: { create: [{ name: '__implicit__', type: 'LUMPSUM', isImplicit: true, lumpsumBhd: 2000 }] },
    },
    include: { subActivities: true },
  })
  ids.lumpsumSub = lumpsum.subActivities[0]!.id

  // Approved progress: measured half-done (50 of 100 m²), lump-sum 50%.
  await prisma.dailyReport.create({
    data: {
      reportCode: `PFE-${sfx}-R1`, projectId: project.id, authorId: admin.id,
      reportDate: new Date('2026-03-15T00:00:00.000Z'), status: 'APPROVED',
      activities: {
        create: [
          { activityId: measured.id, subActivities: { create: [{ subActivityId: ids.measuredSub, quantityDone: 50 }] } },
          { activityId: lumpsum.id, subActivities: { create: [{ subActivityId: ids.lumpsumSub, percentComplete: 50 }] } },
        ],
      },
    },
  })
})

afterAll(async () => {
  if (ids.projectId) {
    await prisma.dailyReport.deleteMany({ where: { projectId: ids.projectId } })
    await prisma.valuation.deleteMany({ where: { projectId: ids.projectId } })
    await prisma.project.deleteMany({ where: { id: ids.projectId } })
  }
  await prisma.laborCategory.deleteMany({ where: { name: LABOUR } })
  if (ids.userId) await prisma.user.deleteMany({ where: { id: ids.userId } })
  await prisma.$disconnect()
})

describe('6E-pre → 6D end-to-end', () => {
  it('BEFORE: with no terms set, retention and advance recovery are zero', async () => {
    const c = (await computeValuation(ids.projectId!, '2026-03-01'))!
    expect(c.retentionHeld).toBe(0)
    expect(c.advanceRecovery).toBe(0)
  })

  it('the project route persists retention 10 / cap 5 / advance 20 / terms 30', async () => {
    const res = await patchProject(patchReq({ retentionPct: 10, retentionCapPct: 5, advancePct: 20, paymentTermsDays: 30 }), { params: { id: ids.projectId! } })
    expect(res.status).toBe(200)

    const p = await prisma.project.findUnique({
      where: { id: ids.projectId! },
      select: { retentionPct: true, retentionCapPct: true, advancePct: true, paymentTermsDays: true },
    })
    expect(Number(p!.retentionPct)).toBe(10)
    expect(Number(p!.retentionCapPct)).toBe(5)
    expect(Number(p!.advancePct)).toBe(20)
    expect(p!.paymentTermsDays).toBe(30)
  })

  it('AFTER: the valuation engine now reads those terms — retention and advance are non-zero', async () => {
    // Contract value = 10×100 measured + 4,000 lumpsum = 5,000.
    // Cumulative gross = 500 measured (50%) + 2,000 lumpsum (50%) = 2,500.
    const c = (await computeValuation(ids.projectId!, '2026-03-01'))!
    expect(c.cumulativeGross).toBe(2500)
    expect(c.retentionHeld).toBe(250) // 10% of 2,500, under the 5%×5,000 = 250 cap
    expect(c.advanceRecovery).toBe(500) // 20% of the 2,500 first-period gross
    expect(c.netThisPeriod).toBe(1750) // 2,500 − 250 − 500
  })

  it('certifying through the route freezes the snapshots and sets expectedReceipt = certifiedAt + 30 days', async () => {
    const computed = (await computeValuation(ids.projectId!, '2026-03-01'))!
    const draft = await prisma.valuation.create({
      data: {
        valuationCode: `VAL-PFE-${sfx}-01`, projectId: ids.projectId!, periodMonth: new Date('2026-03-01T00:00:00.000Z'),
        revisionNumber: 0, status: 'DRAFT', createdBy: ids.userId!,
        ...computationToHeader(computed), lines: { create: computationToLines(computed) },
      },
    })

    const res = await certifyValuation(new NextRequest('http://test/api/x', { method: 'POST' }), { params: { id: ids.projectId!, vid: draft.id } })
    expect(res.status).toBe(200)

    const certified = await prisma.valuation.findUnique({
      where: { id: draft.id },
      select: { status: true, certifiedAt: true, expectedReceipt: true, retentionHeld: true, advanceRecovery: true, retentionPctAtCert: true, advancePctAtCert: true, contractValueAtCert: true },
    })
    expect(certified!.status).toBe('CERTIFIED')
    expect(Number(certified!.retentionHeld)).toBe(250)
    expect(Number(certified!.advanceRecovery)).toBe(500)
    expect(Number(certified!.retentionPctAtCert)).toBe(10)
    expect(Number(certified!.advancePctAtCert)).toBe(20)
    expect(Number(certified!.contractValueAtCert)).toBe(5000)

    // expectedReceipt = certifiedAt + 30 days (NOT the 45-day column default).
    const cert = certified!.certifiedAt!
    const expected = new Date(Date.UTC(cert.getUTCFullYear(), cert.getUTCMonth(), cert.getUTCDate() + 30))
    expect(certified!.expectedReceipt!.toISOString().slice(0, 10)).toBe(expected.toISOString().slice(0, 10))
  })
})
