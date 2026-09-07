import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { weekBoundary, loadWeeklySummary } from '@/lib/weeklySummary.server'
import { renderWeeklySummaryPdf } from '@/lib/pdf/render'
import { deliverWeeklySummary } from '@/lib/notify/weeklySummary.server'

// The mail transport is a no-op under VITEST (mailTransportGuard), so sendRecordedEmail records
// EmailSend rows without sending — exactly what the idempotency/empty-list assertions need.
const prisma = new PrismaClient()
const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const ids: Record<string, string> = {}

// A Sunday 08:00 Bahrain instant = 05:00 UTC. Covered week = the previous Sun→Sat.
const SUNDAY = new Date('2026-01-04T05:00:00.000Z')
const WEEK_KEY = '2025-12-28' // that week's Sunday
const EMPTY_SUNDAY = new Date('2026-01-11T05:00:00.000Z') // a different week, for the empty-list test
const EMPTY_KEY = '2026-01-04'

beforeAll(async () => {
  const user = await prisma.user.create({ data: { userCode: `TWS-U-${sfx}`, email: `tws_${sfx}@e.local`, passwordHash: 'x', firstName: 'W', lastName: 'S', role: 'ADMIN' } })
  ids.userId = user.id
  const cat = await prisma.laborCategory.create({ data: { name: `Mason ${sfx}`, hourlyRate: 10 } })

  // Alpha: active, with progress inside the covered week.
  const alpha = await prisma.project.create({ data: { projectCode: `TWS-A-${sfx}`, name: `Alpha ${sfx}`, status: 'ACTIVE', createdBy: user.id } })
  ids.alpha = alpha.id
  const aAsset = await prisma.asset.create({ data: { projectId: alpha.id, name: 'Tower A', ref: 'A', sortOrder: 0 } })
  const coat = await prisma.activity.create({
    data: {
      assetId: aAsset.id, name: 'Facade', ref: '3.1', unit: 'm2', boqQuantity: 100, billRate: 500, sortOrder: 0,
      subActivities: { create: [{ name: 'Coat', type: 'MEASURED', sortOrder: 0, manpowerBudget: { create: [{ laborCategoryId: cat.id, hoursPerUnit: 1, costRateAtPlacement: 10 }] } }] },
    },
    include: { subActivities: true },
  })
  const coatSub = coat.subActivities[0]!.id
  await prisma.dailyReport.create({
    data: {
      reportCode: `TWS-DR-${sfx}-A`, projectId: alpha.id, authorId: user.id, reportDate: new Date('2025-12-30T00:00:00.000Z'), status: 'APPROVED',
      activities: { create: [{ activityId: coat.id, subActivities: { create: [{ subActivityId: coatSub, quantityDone: 40, manpower: { create: [{ categoryId: cat.id, headcount: 5, hours: 8 }] } }] } }] },
    },
  })

  // Beta: active, but did NOTHING in the week — must still get a page.
  const beta = await prisma.project.create({ data: { projectCode: `TWS-B-${sfx}`, name: `Beta ${sfx}`, status: 'ACTIVE', createdBy: user.id } })
  ids.beta = beta.id
  const bAsset = await prisma.asset.create({ data: { projectId: beta.id, name: 'Block B', sortOrder: 0 } })
  await prisma.activity.create({
    data: {
      assetId: bAsset.id, name: 'Earthworks', unit: 'm3', boqQuantity: 200, billRate: 100, sortOrder: 0,
      subActivities: { create: [{ name: 'Excavate', type: 'MEASURED', sortOrder: 0 }] },
    },
  })

  // Gamma: NOT active → excluded from the summary.
  await prisma.project.create({ data: { projectCode: `TWS-G-${sfx}`, name: `Gamma ${sfx}`, status: 'COMPLETED', createdBy: user.id } })
})

afterAll(async () => {
  await prisma.emailSend.deleteMany({ where: { entityType: 'WEEKLY_SUMMARY', entityId: { in: [WEEK_KEY, EMPTY_KEY] } } })
  await prisma.notificationRecipient.deleteMany({ where: { address: { startsWith: `tws_${sfx}` } } })
  await prisma.dailyReport.deleteMany({ where: { reportCode: { startsWith: `TWS-DR-${sfx}` } } })
  await prisma.project.deleteMany({ where: { projectCode: { startsWith: `TWS-` }, createdBy: ids.userId } })
  await prisma.laborCategory.deleteMany({ where: { name: { startsWith: `Mason ${sfx}` } } })
  if (ids.userId) await prisma.user.deleteMany({ where: { id: ids.userId } })
  await prisma.$disconnect()
})

describe('weekBoundary — Sunday→Saturday, Bahrain', () => {
  it('a Sunday 08:00 run covers the previous Sunday–Saturday', () => {
    const w = weekBoundary(SUNDAY)
    expect(w.startStr).toBe('2025-12-28') // Sunday
    expect(w.endStr).toBe('2026-01-03') // Saturday
    expect(w.key).toBe(WEEK_KEY)
    expect(new Date(w.start).getUTCDay()).toBe(0) // Sun
    expect(new Date(w.end).getUTCDay()).toBe(6) // Sat
  })

  it('resolves the Bahrain civil day even just after local midnight (UTC still the day before)', () => {
    // 2026-01-03T22:00Z = 2026-01-04 01:00 Bahrain (a Sunday) → same covered week.
    const w = weekBoundary(new Date('2026-01-03T22:00:00.000Z'))
    expect(w.startStr).toBe('2025-12-28')
    expect(w.endStr).toBe('2026-01-03')
  })
})

describe('loadWeeklySummary', () => {
  it('covers the right week and includes a page for every active project', async () => {
    const data = await loadWeeklySummary({ instant: SUNDAY })
    expect(data.week.startStr).toBe('2025-12-28')
    expect(data.week.endStr).toBe('2026-01-03')
    // Our two active projects are present (other suites clean up; assert on ours).
    const alpha = data.projects.find((p) => p.id === ids.alpha)!
    const beta = data.projects.find((p) => p.id === ids.beta)!
    expect(alpha).toBeTruthy()
    expect(beta).toBeTruthy()
    // Alpha moved this week; Beta did nothing and says so.
    expect(alpha.movement).toBe(40) // 0 → 40% within the week
    expect(alpha.hadActivityThisWeek).toBe(true)
    expect(alpha.manHoursWeek).toBe(40) // 5 × 8
    expect(beta.hadActivityThisWeek).toBe(false)
    expect(beta.movement).toBe(0)
  })

  it('counts reports filed vs expected (calendar days) and flags misses', async () => {
    const data = await loadWeeklySummary({ instant: SUNDAY })
    // Expected = active projects × 7. Our two contribute 14; assert ours are represented.
    expect(data.portfolio.reportsExpected).toBeGreaterThanOrEqual(14)
    // Alpha filed one day; Beta none → both are in the missed list.
    const names = data.portfolio.flags.missedReports.map((m) => m.name)
    expect(names).toContain(`Alpha ${sfx}`)
    expect(names).toContain(`Beta ${sfx}`)
    expect(data.portfolio.flags.missedReports.find((m) => m.name === `Beta ${sfx}`)!.daysMissed).toBe(7)
  })

  it('renders a valid multi-page PDF buffer', async () => {
    const data = await loadWeeklySummary({ instant: SUNDAY })
    const buf = await renderWeeklySummaryPdf(data)
    expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF')
    expect(buf.length).toBeGreaterThan(1000)
  })
})

describe('deliverWeeklySummary', () => {
  it('is idempotent per week — two runs send once', async () => {
    await prisma.notificationRecipient.create({ data: { type: 'WEEKLY_SUMMARY', address: `tws_${sfx}_list@e.local` } })

    const first = await deliverWeeklySummary({ sentById: ids.userId!, instant: SUNDAY })
    const second = await deliverWeeklySummary({ sentById: ids.userId!, instant: SUNDAY })
    expect(first.outcome).toBe('sent')
    expect(second.outcome).toBe('skipped-duplicate')

    const rows = await prisma.emailSend.count({ where: { entityType: 'WEEKLY_SUMMARY', entityId: WEEK_KEY } })
    expect(rows).toBe(1)

    await prisma.notificationRecipient.deleteMany({ where: { address: `tws_${sfx}_list@e.local` } })
  })

  it('sends nothing on an empty recipient list and records why in the audit', async () => {
    const before = await prisma.auditLog.count({ where: { entity: 'Cron', entityId: 'weekly-summary' } })
    const res = await deliverWeeklySummary({ sentById: ids.userId!, instant: EMPTY_SUNDAY })
    expect(res.outcome).toBe('no-recipients')
    const sent = await prisma.emailSend.count({ where: { entityType: 'WEEKLY_SUMMARY', entityId: EMPTY_KEY } })
    expect(sent).toBe(0) // nothing sent
    const after = await prisma.auditLog.count({ where: { entity: 'Cron', entityId: 'weekly-summary' } })
    expect(after).toBe(before + 1) // but the skip was recorded
  })
})
