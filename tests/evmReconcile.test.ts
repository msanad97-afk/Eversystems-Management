import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { loadProjectEvm, loadActivityEvm, loadPortfolioEvm } from '@/lib/evm.server'

/**
 * Hand-built project, hand-computed spreadsheet:
 *
 *   Asset "Tower A"
 *     Activity "Blockwork"  MEASURED, BOQ 1000 m2
 *       sub "Build"  measured: Mason 0.5 hr/m2 @ 2/hr  → BV = 0.5×1000×2 = 1000
 *       sub "Scaffold" LUMPSUM  lumpsumBhd 500          → BV = 500
 *   BAC = 1500
 *
 *   Approved reports (dated by WORK date):
 *     Jan: Build qty 250 (AC 300)              → Build pct 25%  EV 250
 *     Feb: Build qty 250 (AC 200),
 *          Scaffold percentComplete 40 (cum)   → Build pct 50%  EV 500 ; Scaffold EV 200
 *   EV(as of Feb) = 500 + 200 = 700 ; AC = 500
 *
 *   Baseline: Jan 40%, Feb 100%  → PV(28 Feb) = 1.00 × 1500 = 1500
 *   SPI = 700/1500 = 0.4667 ; CPI = 700/500 = 1.4
 */
const prisma = new PrismaClient()
const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const MASON = `EvmMason-${sfx}`
const ids: { userId?: string; projectId?: string; assetId?: string; activityId?: string; buildSub?: string; scaffoldSub?: string } = {}

const FEB_END = new Date('2026-02-28T00:00:00.000Z')

beforeAll(async () => {
  const mason = await prisma.laborCategory.create({ data: { name: MASON, hourlyRate: 2 } })
  const user = await prisma.user.create({ data: { userCode: `EVM-U-${sfx}`, email: `evm_${sfx}@e.local`, passwordHash: 'x', firstName: 'E', lastName: 'V', role: 'SUPERVISOR' } })
  ids.userId = user.id
  const project = await prisma.project.create({
    data: { projectCode: `EVM-P-${sfx}`, name: `EVM ${sfx}`, status: 'ACTIVE', createdBy: user.id, contractValue: 2000 },
  })
  ids.projectId = project.id
  const asset = await prisma.asset.create({ data: { projectId: project.id, name: 'Tower A' } })
  ids.assetId = asset.id

  const activity = await prisma.activity.create({
    data: {
      assetId: asset.id, name: 'Blockwork', unit: 'm2', boqQuantity: 1000, pricedAt: new Date(),
      subActivities: {
        create: [
          { name: 'Build', type: 'MEASURED', sortOrder: 0, manpowerBudget: { create: [{ laborCategoryId: mason.id, hoursPerUnit: 0.5, costRateAtPlacement: 2 }] } },
          { name: 'Scaffold', type: 'LUMPSUM', lumpsumBhd: 500, sortOrder: 1 },
        ],
      },
    },
    include: { subActivities: true },
  })
  ids.activityId = activity.id
  ids.buildSub = activity.subActivities.find((s) => s.name === 'Build')!.id
  ids.scaffoldSub = activity.subActivities.find((s) => s.name === 'Scaffold')!.id

  const mk = (code: string, date: string, status: 'APPROVED' | 'DRAFT', subs: { subActivityId: string; qty?: number; pct?: number; cost?: number }[]) =>
    prisma.dailyReport.create({
      data: {
        reportCode: code, projectId: project.id, authorId: user.id, reportDate: new Date(`${date}T00:00:00.000Z`), status,
        activities: {
          create: [{
            activityId: activity.id,
            subActivities: {
              create: subs.map((s) => ({
                subActivityId: s.subActivityId,
                quantityDone: s.qty ?? null,
                percentComplete: s.pct ?? null,
                manpower: s.cost
                  ? { create: [{ categoryId: mason.id, headcount: 1, hours: 1, rateAtApproval: 2, costAtApproval: s.cost }] }
                  : undefined,
              })),
            },
          }],
        },
      },
    })

  await mk(`EVM-${sfx}-JAN`, '2026-01-20', 'APPROVED', [{ subActivityId: ids.buildSub!, qty: 250, cost: 300 }])
  await mk(`EVM-${sfx}-FEB`, '2026-02-20', 'APPROVED', [
    { subActivityId: ids.buildSub!, qty: 250, cost: 200 },
    { subActivityId: ids.scaffoldSub!, pct: 40 },
  ])
  // A DRAFT must be invisible to EVM.
  await mk(`EVM-${sfx}-DRAFT`, '2026-02-25', 'DRAFT', [{ subActivityId: ids.buildSub!, qty: 500, cost: 9999 }])

  await prisma.baselinePeriod.createMany({
    data: [
      { projectId: project.id, periodMonth: new Date('2026-01-01T00:00:00.000Z'), cumPlannedPct: 40 },
      { projectId: project.id, periodMonth: new Date('2026-02-01T00:00:00.000Z'), cumPlannedPct: 100 },
    ],
  })
})

afterAll(async () => {
  if (ids.projectId) {
    await prisma.dailyReport.deleteMany({ where: { projectId: ids.projectId } })
    await prisma.baselinePeriod.deleteMany({ where: { projectId: ids.projectId } })
    await prisma.project.deleteMany({ where: { id: ids.projectId } })
  }
  await prisma.laborCategory.deleteMany({ where: { name: MASON } })
  if (ids.userId) await prisma.user.deleteMany({ where: { id: ids.userId } })
  await prisma.$disconnect()
})

describe('EVM reconciles to the hand-computed spreadsheet', () => {
  it('BAC = Σ BV over sub-activities (measured build-up + lumpsum)', async () => {
    const e = (await loadProjectEvm(ids.projectId!, FEB_END))!
    expect(e.bac).toBe(1500) // 1000 measured + 500 lumpsum
  })

  it('EV, AC, PV and the indices match by hand', async () => {
    const e = (await loadProjectEvm(ids.projectId!, FEB_END))!
    expect(e.ev).toBe(700) // Build 1000×0.5 + Scaffold 500×0.4
    expect(e.ac).toBe(500) // 300 + 200 (draft's 9999 excluded)
    expect(e.pv).toBe(1500) // 100% × 1500
    expect(e.spi).toBe(0.4667) // 700/1500
    expect(e.cpi).toBe(1.4) // 700/500
    expect(e.pctComplete).toBe(46.7) // EV/BAC
  })

  it('value-weighted % complete equals EV / BAC', async () => {
    const e = (await loadProjectEvm(ids.projectId!, FEB_END))!
    expect(e.pctComplete).toBeCloseTo((e.ev / e.bac) * 100, 1)
  })

  it('a LUMPSUM sub earns from the LATEST approved % — never summed', async () => {
    // Two approved lumpsum reports: 40 then 55 cumulative → EV must use 55, not 95.
    await prisma.dailyReport.create({
      data: {
        reportCode: `EVM-${sfx}-MAR`, projectId: ids.projectId!, authorId: ids.userId!,
        reportDate: new Date('2026-03-10T00:00:00.000Z'), status: 'APPROVED',
        activities: { create: [{ activityId: ids.activityId!, subActivities: { create: [{ subActivityId: ids.scaffoldSub!, percentComplete: 55 }] } }] },
      },
    })
    const e = (await loadProjectEvm(ids.projectId!, new Date('2026-03-31T00:00:00.000Z')))!
    // Build still 500 (500/1000); Scaffold 500 × 0.55 = 275 → 775. Summing would give 500+475.
    expect(e.ev).toBe(775)
    await prisma.dailyReport.deleteMany({ where: { reportCode: `EVM-${sfx}-MAR` } })
  })

  it('a MEASURED sub caps at 100% — EV never exceeds BV', async () => {
    await prisma.dailyReport.create({
      data: {
        reportCode: `EVM-${sfx}-OVER`, projectId: ids.projectId!, authorId: ids.userId!,
        reportDate: new Date('2026-04-10T00:00:00.000Z'), status: 'APPROVED',
        activities: { create: [{ activityId: ids.activityId!, subActivities: { create: [{ subActivityId: ids.buildSub!, quantityDone: 5000 }] } }] },
      },
    })
    const e = (await loadProjectEvm(ids.projectId!, new Date('2026-04-30T00:00:00.000Z')))!
    // Build capped at BV 1000 despite 5500/1000 reported; Scaffold 200 → 1200.
    expect(e.ev).toBe(1200)
    await prisma.dailyReport.deleteMany({ where: { reportCode: `EVM-${sfx}-OVER` } })
  })

  it('the series buckets by reportDate (work month), not approval time', async () => {
    const e = (await loadProjectEvm(ids.projectId!, FEB_END))!
    const jan = e.series.find((s) => s.month === '2026-01-01')!
    const feb = e.series.find((s) => s.month === '2026-02-01')!
    expect(jan.evCum).toBe(250) // only January's work
    expect(jan.acCum).toBe(300)
    expect(feb.evCum).toBe(700) // cumulative through February
    expect(feb.acCum).toBe(500)
    expect(jan.pvCum).toBe(600) // 40% × 1500
    expect(feb.pvCum).toBe(1500)
  })

  it('back-dating an approved report moves value into the WORK month', async () => {
    await prisma.dailyReport.create({
      data: {
        reportCode: `EVM-${sfx}-BACK`, projectId: ids.projectId!, authorId: ids.userId!,
        reportDate: new Date('2026-01-05T00:00:00.000Z'), status: 'APPROVED', // work in January, approved now
        activities: { create: [{ activityId: ids.activityId!, subActivities: { create: [{ subActivityId: ids.buildSub!, quantityDone: 100 }] } }] },
      },
    })
    const e = (await loadProjectEvm(ids.projectId!, FEB_END))!
    const jan = e.series.find((s) => s.month === '2026-01-01')!
    expect(jan.evCum).toBe(350) // January rose: (250+100)/1000 × 1000
    await prisma.dailyReport.deleteMany({ where: { reportCode: `EVM-${sfx}-BACK` } })
  })

  it('asset level exposes cost metrics only — no PV/SPI/SV', async () => {
    const e = (await loadProjectEvm(ids.projectId!, FEB_END))!
    const asset = e.assets[0]!
    expect(asset.cpi).toBe(1.4)
    expect(asset).not.toHaveProperty('pv')
    expect(asset).not.toHaveProperty('spi')
    expect(asset).not.toHaveProperty('sv')
  })

  it('activity drill rolls up to the same numbers', async () => {
    const d = (await loadActivityEvm(ids.projectId!, ids.assetId!, FEB_END))!
    expect(d.activities).toHaveLength(1)
    expect(d.activities[0]!.bac).toBe(1500)
    expect(d.activities[0]!.ev).toBe(700)
  })

  it('expenses move projected margin but NOT CPI', async () => {
    const before = (await loadProjectEvm(ids.projectId!, FEB_END))!
    await prisma.expense.create({
      data: { projectId: ids.projectId!, category: 'SUBCONTRACTOR', description: 'Overhead', amount: 250, expenseDate: new Date('2026-02-10T00:00:00Z'), createdBy: ids.userId! },
    })
    const after = (await loadProjectEvm(ids.projectId!, FEB_END))!
    expect(after.cpi).toBe(before.cpi) // CPI untouched — direct scope only
    expect(after.ac).toBe(before.ac) // expenses never enter AC_direct
    expect(after.expensesTotal).toBe(250)
    // Margin uses the BOTTOM-UP contract value (authoritative since 6A), not the header figure.
    expect(after.projectedMargin).toBe(Math.round((after.contractValue - after.eac - 250) * 1000) / 1000)
    // …and the overhead genuinely moved it.
    expect(after.projectedMargin).toBe(Math.round((before.projectedMargin - 250) * 1000) / 1000)
    await prisma.expense.deleteMany({ where: { projectId: ids.projectId! } })
  })

  it('no baseline → PV/SPI null but cost metrics still work', async () => {
    await prisma.baselinePeriod.deleteMany({ where: { projectId: ids.projectId! } })
    const e = (await loadProjectEvm(ids.projectId!, FEB_END))!
    expect(e.hasBaseline).toBe(false)
    expect(e.pv).toBeNull()
    expect(e.spi).toBeNull()
    expect(e.cpi).toBe(1.4)
    expect(e.series.every((s) => s.pvCum === null)).toBe(true)
    await prisma.baselinePeriod.createMany({
      data: [
        { projectId: ids.projectId!, periodMonth: new Date('2026-01-01T00:00:00.000Z'), cumPlannedPct: 40 },
        { projectId: ids.projectId!, periodMonth: new Date('2026-02-01T00:00:00.000Z'), cumPlannedPct: 100 },
      ],
    })
  })

  it('portfolio weights ACTIVE projects and includes this one', async () => {
    const p = await loadPortfolioEvm(FEB_END)
    const row = p.projects.find((x) => x.projectId === ids.projectId)
    expect(row).toBeTruthy()
    expect(row!.ev).toBe(700)
    expect(p.totals.bac).toBeGreaterThanOrEqual(1500)
  })
})
