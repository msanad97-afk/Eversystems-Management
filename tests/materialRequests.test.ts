import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { resolveReviewStatus, validateRequestLines, validateApprovedQty } from '@/lib/materialRequests/rules'
import { loadScopeSignals } from '@/lib/materialRequests/signals.server'

// ─── Pure review-resolution logic ──────────────────────────────────────────────

describe('resolveReviewStatus', () => {
  it('APPROVED when every line is approved in full', () => {
    expect(resolveReviewStatus([{ requestedQty: 10, approvedQty: 10 }, { requestedQty: 5, approvedQty: 5 }])).toBe('APPROVED')
  })
  it('REJECTED when every line is rejected (approved 0)', () => {
    expect(resolveReviewStatus([{ requestedQty: 10, approvedQty: 0 }, { requestedQty: 5, approvedQty: 0 }])).toBe('REJECTED')
  })
  it('PARTIALLY_APPROVED when a line is modified', () => {
    expect(resolveReviewStatus([{ requestedQty: 10, approvedQty: 8 }, { requestedQty: 5, approvedQty: 5 }])).toBe('PARTIALLY_APPROVED')
  })
  it('PARTIALLY_APPROVED when some (not all) lines are rejected', () => {
    expect(resolveReviewStatus([{ requestedQty: 10, approvedQty: 0 }, { requestedQty: 5, approvedQty: 5 }])).toBe('PARTIALLY_APPROVED')
  })
  it('empty resolves to REJECTED', () => {
    expect(resolveReviewStatus([])).toBe('REJECTED')
  })
})

describe('validation', () => {
  it('rejects duplicate materials, empty, and non-positive quantities', () => {
    expect(validateRequestLines([])).not.toBeNull()
    expect(validateRequestLines([{ materialId: 'm1', requestedQty: 0 }])).not.toBeNull()
    expect(validateRequestLines([{ materialId: 'm1', requestedQty: 5 }, { materialId: 'm1', requestedQty: 2 }])).not.toBeNull()
    expect(validateRequestLines([{ materialId: 'm1', requestedQty: 5 }])).toBeNull()
  })
  it('approvedQty must be a finite number >= 0 (0 = reject, never negative)', () => {
    expect(validateApprovedQty(0)).toBe(true)
    expect(validateApprovedQty(5)).toBe(true)
    expect(validateApprovedQty(-1)).toBe(false)
    expect(validateApprovedQty('5')).toBe(false)
  })
})

// ─── DB-backed: signals, scope grain, and the money wall ───────────────────────

const prisma = new PrismaClient()
const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const ids: { userId?: string; projectId?: string; activityId?: string; materialId?: string } = {}

const SECRET_UNIT_RATE = 12.5 // Material.unitRate — must never reach the supervisor payload
const SECRET_PLACEMENT_COST = 99.999 // SubActivityMaterialBudget.costRateAtPlacement — ditto

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { userCode: `TSTR-U-${sfx}`, email: `tstr_${sfx}@e.local`, passwordHash: 'x', firstName: 'Req', lastName: 'Author', role: 'SUPERVISOR' },
  })
  ids.userId = user.id
  const project = await prisma.project.create({ data: { projectCode: `TSTR-P-${sfx}`, name: `Requests ${sfx}`, createdBy: user.id } })
  ids.projectId = project.id
  await prisma.projectMember.create({ data: { projectId: project.id, userId: user.id } })
  const asset = await prisma.asset.create({ data: { projectId: project.id, name: 'Tower A' } })
  const activity = await prisma.activity.create({
    data: {
      assetId: asset.id, name: 'EIFS', unit: 'm2', boqQuantity: 100,
      subActivities: { create: [{ name: '__implicit__', type: 'MEASURED', isImplicit: true }] },
    },
    include: { subActivities: true },
  })
  ids.activityId = activity.id
  const subId = activity.subActivities[0]!.id

  const material = await prisma.material.create({ data: { name: `EPS board ${sfx}`, unit: 'sheets', unitRate: SECRET_UNIT_RATE } })
  ids.materialId = material.id
  // Budgeted rate 5 sheets/m² → project budget = 5 × 100 = 500. Cost sits on the same row.
  await prisma.subActivityMaterialBudget.create({
    data: { subActivityId: subId, materialId: material.id, qtyPerUnit: 5, costRateAtPlacement: SECRET_PLACEMENT_COST },
  })

  const mkReq = async (
    code: string,
    status: 'APPROVED' | 'SUBMITTED' | 'DRAFT',
    requestedQty: number,
    approvedQty: number | null,
    scope: { assetId?: string; activityId?: string } = {},
  ) => {
    await prisma.materialRequest.create({
      data: {
        requestCode: code, projectId: project.id, requestedById: user.id, status,
        assetId: scope.assetId ?? null, activityId: scope.activityId ?? null,
        submittedAt: status === 'DRAFT' ? null : new Date(),
        lines: { create: [{ materialId: material.id, unit: 'sheets', requestedQty, approvedQty, sortOrder: 0 }] },
      },
    })
  }
  // Project-grain: approved 80, pending (submitted) 30, draft 999 (ignored).
  await mkReq(`TSTR-${sfx}-R1`, 'APPROVED', 100, 80)
  await mkReq(`TSTR-${sfx}-R2`, 'SUBMITTED', 30, null)
  await mkReq(`TSTR-${sfx}-R3`, 'DRAFT', 999, null)
  // Activity-grain: approved 20 — must be invisible to the project-grain view and vice-versa.
  await mkReq(`TSTR-${sfx}-R4`, 'APPROVED', 25, 20, { activityId: activity.id })
})

afterAll(async () => {
  await prisma.materialRequest.deleteMany({ where: { requestCode: { startsWith: `TSTR-${sfx}` } } })
  if (ids.projectId) await prisma.project.deleteMany({ where: { id: ids.projectId } })
  if (ids.materialId) await prisma.material.deleteMany({ where: { id: ids.materialId } })
  if (ids.userId) await prisma.user.deleteMany({ where: { id: ids.userId } })
  await prisma.$disconnect()
})

describe('scope signals — budgeted, requested-so-far, pending', () => {
  it('project grain: budgeted from rollup, approved-only cumulative, pending shown separately', async () => {
    const signals = await loadScopeSignals({ projectId: ids.projectId!, assetId: null, activityId: null })
    const s = signals.find((x) => x.materialId === ids.materialId)!
    expect(s.budgetedQty).toBe(500) // 5 × 100
    expect(s.requestedSoFar).toBe(80) // R1 approved only (draft 999 + submitted 30 excluded)
    expect(s.pending).toBe(30) // R2 submitted
  })

  it('scope grain isolates: activity-grain approvals do not count at project grain', async () => {
    const projectSignals = await loadScopeSignals({ projectId: ids.projectId!, assetId: null, activityId: null })
    expect(projectSignals.find((x) => x.materialId === ids.materialId)!.requestedSoFar).toBe(80) // not 100 (R4 excluded)

    const activitySignals = await loadScopeSignals({ projectId: ids.projectId!, assetId: null, activityId: ids.activityId })
    const a = activitySignals.find((x) => x.materialId === ids.materialId)!
    expect(a.budgetedQty).toBe(500) // activity rollup
    expect(a.requestedSoFar).toBe(20) // only R4 (project-grain R1 excluded)
  })

  it('excludeRequestId drops a request from the cumulative', async () => {
    const r1 = await prisma.materialRequest.findFirst({ where: { requestCode: `TSTR-${sfx}-R1` }, select: { id: true } })
    const signals = await loadScopeSignals({ projectId: ids.projectId!, assetId: null, activityId: null }, r1!.id)
    expect(signals.find((x) => x.materialId === ids.materialId)!.requestedSoFar).toBe(0)
  })
})

describe('the money wall — no cost reaches the supervisor signal payload', () => {
  it('signal objects carry only quantity fields', async () => {
    const signals = await loadScopeSignals({ projectId: ids.projectId!, assetId: null, activityId: null })
    const s = signals.find((x) => x.materialId === ids.materialId)!
    expect(Object.keys(s).sort()).toEqual(['budgetedQty', 'materialId', 'materialName', 'pending', 'requestedSoFar', 'unit'])
  })

  it('no cost key or cost value appears anywhere in the signal payload', async () => {
    const signals = await loadScopeSignals({ projectId: ids.projectId!, assetId: null, activityId: null })
    const serialized = JSON.stringify(signals)
    expect(serialized).not.toContain('unitRate')
    expect(serialized).not.toContain('costRateAtPlacement')
    expect(serialized).not.toContain(String(SECRET_UNIT_RATE))
    expect(serialized).not.toContain(String(SECRET_PLACEMENT_COST))
  })
})
