import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { lumpsumFloorBySubActivity } from '@/lib/reports/progress'
import { loadProjectOverview } from '@/lib/projectOverview.server'

// The shared lumpsum-percent lookup gains an optional as-of date. A lumpsum sub reported at 40% last
// month and 70% this week must read 40% as of eight days ago and 70% today; the matrix (7-day
// baseline) must then flag that cell +30. Existing callers passing no date keep latest-overall.
const prisma = new PrismaClient()
const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const ids: Record<string, string> = {}

const now = new Date()
const day = (delta: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + delta))
const LAST_MONTH = day(-30)
const THIS_WEEK = day(-2) // inside the 7-day window
const EIGHT_DAYS_AGO = day(-8)
const TODAY = day(0)

beforeAll(async () => {
  const user = await prisma.user.create({ data: { userCode: `TLA-U-${sfx}`, email: `tla_${sfx}@e.local`, passwordHash: 'x', firstName: 'L', lastName: 'A', role: 'ADMIN' } })
  ids.userId = user.id
  const project = await prisma.project.create({ data: { projectCode: `TLA-P-${sfx}`, name: `Lumpsum ${sfx}`, status: 'ACTIVE', createdBy: user.id } })
  ids.projectId = project.id
  const asset = await prisma.asset.create({ data: { projectId: project.id, name: 'Tower A', ref: 'A', sortOrder: 0 } })

  // Activity with a single LUMPSUM sub "Scaffold".
  const activity = await prisma.activity.create({
    data: {
      assetId: asset.id, name: 'Facade', ref: '3.1', unit: 'm2', boqQuantity: 100, billRate: 777, sortOrder: 0,
      subActivities: { create: [{ name: 'Scaffold', type: 'LUMPSUM', lumpsumBhd: 2000, sortOrder: 0 }] },
    },
    include: { subActivities: true },
  })
  ids.scaffold = activity.subActivities[0]!.id

  const report = (code: string, date: Date, pct: number) =>
    prisma.dailyReport.create({
      data: {
        reportCode: code, projectId: project.id, authorId: user.id, reportDate: date, status: 'APPROVED',
        activities: { create: [{ activityId: activity.id, subActivities: { create: [{ subActivityId: ids.scaffold!, percentComplete: pct }] } }] },
      },
    })
  await report(`TLA-DR-${sfx}-OLD`, LAST_MONTH, 40)
  await report(`TLA-DR-${sfx}-NEW`, THIS_WEEK, 70)
})

afterAll(async () => {
  await prisma.dailyReport.deleteMany({ where: { reportCode: { startsWith: `TLA-DR-${sfx}` } } })
  if (ids.projectId) await prisma.project.deleteMany({ where: { id: ids.projectId } })
  if (ids.userId) await prisma.user.deleteMany({ where: { id: ids.userId } })
  await prisma.$disconnect()
})

describe('lumpsumFloorBySubActivity — optional as-of date', () => {
  it('reads 40% as of eight days ago and 70% today', async () => {
    const eightAgo = await lumpsumFloorBySubActivity([ids.scaffold!], EIGHT_DAYS_AGO)
    expect(eightAgo.get(ids.scaffold!)).toBe(40) // this-week's 70% is after the cutoff
    const today = await lumpsumFloorBySubActivity([ids.scaffold!], TODAY)
    expect(today.get(ids.scaffold!)).toBe(70)
  })

  it('is unchanged when no date is passed (latest-overall)', async () => {
    const latest = await lumpsumFloorBySubActivity([ids.scaffold!])
    expect(latest.get(ids.scaffold!)).toBe(70)
  })
})

describe('matrix 7-day baseline for lumpsum', () => {
  it('flags the lumpsum cell with a +30 delta (40% → 70% within the window)', async () => {
    const o = (await loadProjectOverview(ids.projectId!))!
    const m = o.matrix[0]!
    const iScaffold = m.columns.findIndex((c) => c.name === 'Scaffold')
    const cell = m.rows[0]!.cells[iScaffold]!
    expect(cell.percent).toBe(70)
    expect(cell.delta).toBe(30)
  })
})
