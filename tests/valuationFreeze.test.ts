import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { loadProjectMoney } from '@/lib/money.server'
import {
  computeValuation, computationToHeader, computationToLines, certifyBlockers, loadValuation, listValuations,
} from '@/lib/valuation.server'

/**
 * Phase 6D against a real database. Two things are worth proving here that a mocked test
 * cannot: that the multi-stage measured formula reads off real reported rows, and that a
 * CERTIFIED revision is genuinely frozen — later approved progress moves the computation but
 * not the certificate.
 *
 * Scope under test (one asset, contract value 5,000):
 *   MEASURED  Blockwork  BOQ 100 m² × billRate 10        → contract 1,000
 *             three PARALLEL stage subs on that same BOQ, BV 100 each (Σ BV 300)
 *   LUMPSUM   Waterproofing  cost 2,000, asset lumpsumRevenue 4,000
 */
const prisma = new PrismaClient()
const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const LABOUR = `VfLabour-${sfx}`
const ids: Record<string, string> = {}
const stageSubs: string[] = []

/** Approve a report dated `date` carrying the given sub-activity rows. */
async function approvedReport(date: string, code: string, rows: { subActivityId: string; quantityDone?: number; percentComplete?: number }[]) {
  const byActivity = new Map<string, typeof rows>()
  for (const r of rows) {
    const key = stageSubs.includes(r.subActivityId) || r.subActivityId === ids.measuredSolo ? ids.measuredActivity! : ids.lumpsumActivity!
    byActivity.set(key, [...(byActivity.get(key) ?? []), r])
  }
  return prisma.dailyReport.create({
    data: {
      reportCode: code, projectId: ids.projectId!, authorId: ids.userId!,
      reportDate: new Date(`${date}T00:00:00.000Z`), status: 'APPROVED',
      activities: {
        create: [...byActivity.entries()].map(([activityId, subs]) => ({
          activityId,
          subActivities: { create: subs.map((s) => ({ subActivityId: s.subActivityId, quantityDone: s.quantityDone ?? null, percentComplete: s.percentComplete ?? null })) },
        })),
      },
    },
  })
}

/** Certify a computed period exactly as the certify route does: recompute, then freeze. */
async function certify(periodMonth: string, valuationId: string) {
  const c = (await computeValuation(ids.projectId!, periodMonth))!
  await prisma.valuationLine.deleteMany({ where: { valuationId } })
  await prisma.valuation.update({
    where: { id: valuationId },
    data: {
      ...computationToHeader(c),
      status: 'CERTIFIED',
      certifiedAt: new Date(),
      contractValueAtCert: c.contractValue,
      retentionPctAtCert: 10,
      advancePctAtCert: null,
      lines: { create: computationToLines(c) },
    },
  })
  return c
}

async function createDraft(periodMonth: string, code: string, revisionNumber = 0) {
  const c = (await computeValuation(ids.projectId!, periodMonth))!
  const v = await prisma.valuation.create({
    data: {
      valuationCode: code, projectId: ids.projectId!, periodMonth: new Date(`${periodMonth}T00:00:00.000Z`),
      revisionNumber, status: 'DRAFT', createdBy: ids.userId!,
      ...computationToHeader(c),
      lines: { create: computationToLines(c) },
    },
  })
  return { id: v.id, computed: c }
}

beforeAll(async () => {
  const labour = await prisma.laborCategory.create({ data: { name: LABOUR, hourlyRate: 1 } })
  const user = await prisma.user.create({ data: { userCode: `VF-U-${sfx}`, email: `vf_${sfx}@e.local`, passwordHash: 'x', firstName: 'V', lastName: 'F', role: 'ADMIN' } })
  ids.userId = user.id

  const project = await prisma.project.create({
    data: { projectCode: `VF-P-${sfx}`, name: `Val ${sfx}`, status: 'ACTIVE', createdBy: user.id, retentionPct: 10, paymentTermsDays: 45 },
  })
  ids.projectId = project.id

  const asset = await prisma.asset.create({ data: { projectId: project.id, name: 'Block A', lumpsumRevenue: 4000 } })
  ids.assetId = asset.id

  // MEASURED with three PARALLEL stage subs against the SAME 100 m² BOQ.
  const measured = await prisma.activity.create({
    data: {
      assetId: asset.id, name: 'Blockwork', type: 'MEASURED', unit: 'm2', boqQuantity: 100, billRate: 10,
      subActivities: {
        create: ['EPS fixing', 'Basecoat', 'Painting'].map((name, i) => ({
          name, type: 'MEASURED' as const, sortOrder: i,
          manpowerBudget: { create: [{ laborCategoryId: labour.id, hoursPerUnit: 1, costRateAtPlacement: 1 }] }, // BV = 1 × 100 × 1
        })),
      },
    },
    include: { subActivities: { orderBy: { sortOrder: 'asc' } } },
  })
  ids.measuredActivity = measured.id
  stageSubs.push(...measured.subActivities.map((s) => s.id))

  const lumpsum = await prisma.activity.create({
    data: {
      assetId: asset.id, name: 'Waterproofing', type: 'LUMPSUM', unit: null, boqQuantity: 0,
      subActivities: { create: [{ name: '__implicit__', type: 'LUMPSUM', isImplicit: true, lumpsumBhd: 2000 }] },
    },
    include: { subActivities: true },
  })
  ids.lumpsumActivity = lumpsum.id
  ids.lumpsumSub = lumpsum.subActivities[0]!.id

  // JANUARY: stage 1 complete (100 of 100 m²); lump-sum 25% done.
  await approvedReport('2026-01-20', `VF-${sfx}-R1`, [
    { subActivityId: stageSubs[0]!, quantityDone: 100 },
    { subActivityId: ids.lumpsumSub!, percentComplete: 25 },
  ])
})

afterAll(async () => {
  if (ids.projectId) {
    await prisma.dailyReport.deleteMany({ where: { projectId: ids.projectId } })
    await prisma.valuation.deleteMany({ where: { projectId: ids.projectId } }) // lines cascade
    await prisma.project.deleteMany({ where: { id: ids.projectId } })
  }
  await prisma.laborCategory.deleteMany({ where: { name: LABOUR } })
  if (ids.userId) await prisma.user.deleteMany({ where: { id: ids.userId } })
  await prisma.$disconnect()
})

describe('Asset.lumpsumRevenue folds into contract value (additive to 6A)', () => {
  it('project contract value = measured bill value + agreed lump-sum revenue', async () => {
    const money = await loadProjectMoney(ids.projectId!)
    expect(money!.assets[0]!.lumpsumRevenue).toBe(4000)
    expect(money!.contractValue).toBe(5000) // 10 × 100 measured + 4,000 lumpsum
    expect(money!.bac).toBe(2300) // cost: 3 × 100 build-up + 2,000 lumpsum cost
  })
})

describe('the multi-stage measured formula, against real reported rows', () => {
  it('certifies at the BV-weighted percent, NOT the sum of sub-quantities', async () => {
    const c = (await computeValuation(ids.projectId!, '2026-01-01'))!
    // One of three parallel stages complete = 1/3 of the activity, not 100 of 100 m².
    expect(c.cumulativeMeasured).toBeCloseTo(333.3, 1)
    expect(c.cumulativeMeasured).toBeLessThan(1000) // summing quantities would have read 1,000
  })

  it('lump-sum certifies the agreed REVENUE × cost-progress, never the earned cost', async () => {
    const c = (await computeValuation(ids.projectId!, '2026-01-01'))!
    // 25% of a 2,000 cost budget is 500 of earned COST; the certificate bills 25% of 4,000.
    expect(c.cumulativeLumpsum).toBe(1000)
  })

  it('gross = measured + lumpsum, with retention on the cumulative', async () => {
    const c = (await computeValuation(ids.projectId!, '2026-01-01'))!
    expect(c.cumulativeGross).toBeCloseTo(1333.3, 1)
    expect(c.grossThisPeriod).toBeCloseTo(1333.3, 1) // no prior certificate
    expect(c.retentionHeld).toBeCloseTo(133.33, 2)
    expect(c.netThisPeriod).toBeCloseTo(1199.97, 2)
  })
})

describe('certify freezes the revision', () => {
  it('a report approved AFTER certification does not move the certified certificate', async () => {
    const jan = await createDraft('2026-01-01', `VAL-VF-${sfx}-01`)
    const certified = await certify('2026-01-01', jan.id)
    ids.janV0 = jan.id
    const frozenGross = certified.cumulativeGross

    // New approved work lands INSIDE January, after the certificate was issued.
    await approvedReport('2026-01-25', `VF-${sfx}-R2`, [{ subActivityId: stageSubs[1]!, quantityDone: 100 }])

    const reread = await loadValuation(ids.projectId!, jan.id)
    expect(reread!.status).toBe('CERTIFIED')
    expect(reread!.grossAmount).toBeCloseTo(frozenGross, 3) // unchanged

    // …while a fresh computation of the same month HAS moved. The two differ on purpose.
    const recomputed = await computeValuation(ids.projectId!, '2026-01-01')
    expect(recomputed!.cumulativeGross).toBeGreaterThan(frozenGross)
  })

  it('froze the parameter snapshots and the per-asset lines', async () => {
    const v = await loadValuation(ids.projectId!, ids.janV0!)
    expect(v!.contractValueAtCert).toBe(5000)
    expect(v!.retentionPctAtCert).toBe(10)
    expect(v!.advancePctAtCert).toBeNull()
    expect(v!.lines).toHaveLength(1)
    expect(v!.lines[0]!.assetName).toBe('Block A')
    expect(v!.lines[0]!.cumulativeGross).toBeCloseTo(1333.3, 1)
  })
})

describe('a second period bills only the increment', () => {
  it('previousGross comes from the prior certified revision', async () => {
    // February: lump-sum reaches 50%. January's stage-2 work is already in the cumulative.
    await approvedReport('2026-02-10', `VF-${sfx}-R3`, [{ subActivityId: ids.lumpsumSub!, percentComplete: 50 }])

    const feb = await createDraft('2026-02-01', `VAL-VF-${sfx}-02`)
    const c = feb.computed
    ids.febV0 = feb.id

    expect(c.previousGross).toBeCloseTo(1333.3, 1) // January's certified cumulative
    expect(c.cumulativeMeasured).toBeCloseTo(666.7, 1) // two of three stages
    expect(c.cumulativeLumpsum).toBe(2000) // 50% of 4,000
    expect(c.grossThisPeriod).toBeCloseTo(c.cumulativeGross - 1333.3, 2)
    // Retention accrues on the cumulative, and only the delta is deducted this period.
    expect(c.retentionThisPeriod).toBeCloseTo(c.retentionHeld - 133.33, 2)
  })
})

describe('re-issue: supersede, never mutate', () => {
  it('creates the next revision as a DRAFT and leaves the approved one frozen and readable', async () => {
    const before = await loadValuation(ids.projectId!, ids.janV0!)
    const supersededAt = new Date()

    await prisma.$transaction(async (tx) => {
      const live = await tx.valuation.updateMany({ where: { id: ids.janV0!, supersededAt: null }, data: { supersededAt } })
      expect(live.count).toBe(1)
      const c = (await computeValuation(ids.projectId!, '2026-01-01'))!
      const created = await tx.valuation.create({
        data: {
          valuationCode: `VAL-VF-${sfx}-01-r1`, projectId: ids.projectId!, periodMonth: new Date('2026-01-01T00:00:00.000Z'),
          revisionNumber: 1, status: 'DRAFT', createdBy: ids.userId!,
          ...computationToHeader(c), lines: { create: computationToLines(c) },
        },
      })
      ids.janV1 = created.id
    })

    const after = await loadValuation(ids.projectId!, ids.janV0!)
    expect(after!.supersededAt).not.toBeNull()
    expect(after!.status).toBe('CERTIFIED') // still readable, still approved
    expect(after!.grossAmount).toBe(before!.grossAmount) // substance untouched

    const rev1 = await loadValuation(ids.projectId!, ids.janV1!)
    expect(rev1!.revisionNumber).toBe(1)
    expect(rev1!.status).toBe('DRAFT')
    expect(rev1!.grossAmount).toBeGreaterThan(after!.grossAmount) // picks up the later January work
  })

  it('leaves exactly one LIVE revision for the month, and the list shows it', async () => {
    const live = await prisma.valuation.count({
      where: { projectId: ids.projectId!, periodMonth: new Date('2026-01-01T00:00:00.000Z'), supersededAt: null },
    })
    expect(live).toBe(1)

    const list = await listValuations(ids.projectId!)
    const jan = list.find((v) => v.periodMonth === '2026-01-01')!
    expect(jan.id).toBe(ids.janV1)
    expect(jan.revisionNumber).toBe(1)
    expect(jan.revisionCount).toBe(2)
  })

  it('re-issuing January does NOT mutate February’s already-issued certificate', async () => {
    const febBefore = await loadValuation(ids.projectId!, ids.febV0!)
    await certify('2026-01-01', ids.janV1!) // January rev 1 approved at a HIGHER gross
    const febAfter = await loadValuation(ids.projectId!, ids.febV0!)

    expect(febAfter!.grossAmount).toBe(febBefore!.grossAmount)
    expect(febAfter!.previousGross).toBe(febBefore!.previousGross)
    expect(febAfter!.netPayable).toBe(febBefore!.netPayable)

    // The correction surfaces the next time February is prepared — as real IPCs behave.
    const febRecomputed = await computeValuation(ids.projectId!, '2026-02-01')
    expect(febRecomputed!.previousGross).toBeGreaterThan(febBefore!.previousGross)
  })
})

describe('the certification gate', () => {
  it('is clear while every measured activity is priced and lump-sum revenue is agreed', async () => {
    expect(await certifyBlockers(ids.projectId!)).toEqual([])
  })

  it('blocks — and certifies lump-sum at zero — when lumpsumRevenue is not agreed', async () => {
    await prisma.asset.update({ where: { id: ids.assetId! }, data: { lumpsumRevenue: null } })
    try {
      const blockers = await certifyBlockers(ids.projectId!)
      expect(blockers).toHaveLength(1)
      expect(blockers[0]!.kind).toBe('ASSET_LUMPSUM_REVENUE')
      expect(blockers[0]!.name).toBe('Block A')

      const c = (await computeValuation(ids.projectId!, '2026-02-01'))!
      expect(c.cumulativeLumpsum).toBe(0) // would silently under-bill — hence the block
    } finally {
      await prisma.asset.update({ where: { id: ids.assetId! }, data: { lumpsumRevenue: 4000 } })
    }
  })

  it('blocks when a measured activity carries no bill rate', async () => {
    await prisma.activity.update({ where: { id: ids.measuredActivity! }, data: { billRate: null } })
    try {
      const blockers = await certifyBlockers(ids.projectId!)
      expect(blockers.some((b) => b.kind === 'ACTIVITY_BILL' && b.name === 'Blockwork')).toBe(true)

      const c = (await computeValuation(ids.projectId!, '2026-02-01'))!
      expect(c.cumulativeMeasured).toBe(0)
    } finally {
      await prisma.activity.update({ where: { id: ids.measuredActivity! }, data: { billRate: 10 } })
    }
  })
})
