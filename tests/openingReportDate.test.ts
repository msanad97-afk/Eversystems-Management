import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { PrismaClient } from '@prisma/client'

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/email/transport', () => ({ sendMail: vi.fn() }))

import { getServerSession } from 'next-auth'
import { POST as createOpening } from '@/app/api/projects/[id]/opening-report/route'
import { PATCH as saveReport } from '@/app/api/reports/[id]/route'
import { defaultOpeningDate, validateOpeningDate } from '@/lib/reports/opening'

const prisma = new PrismaClient()
const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const ids: Record<string, string> = {}
const D = (s: string) => new Date(`${s}T00:00:00.000Z`)
const actAs = (userId: string) => vi.mocked(getServerSession).mockResolvedValue({ user: { id: userId } } as never)
const post = (body?: unknown) => new NextRequest('http://test/api/x', body === undefined ? { method: 'POST' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const patch = (body: unknown) => new NextRequest('http://test/api/x', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

let projectSeq = 0
async function makeProject(startDate: string | null): Promise<string> {
  const project = await prisma.project.create({ data: { projectCode: `TOD-P${projectSeq++}-${sfx}`, name: `OD ${sfx}`, status: 'ACTIVE', startDate: startDate ? D(startDate) : null, createdBy: ids.adminId! } })
  const asset = await prisma.asset.create({ data: { projectId: project.id, name: 'A' } })
  await prisma.activity.create({ data: { assetId: asset.id, name: 'Act', unit: 'm2', boqQuantity: 100, subActivities: { create: [{ name: 'Sub', type: 'MEASURED', sortOrder: 0 }] } } })
  return project.id
}
let reportSeq = 0
async function addReport(projectId: string, date: string, authorId: string) {
  await prisma.dailyReport.create({ data: { reportCode: `TOD-DR${reportSeq++}-${sfx}`, projectId, authorId, reportDate: D(date), status: 'APPROVED' } })
}
const openingDate = async (id: string) => (await prisma.dailyReport.findUnique({ where: { id }, select: { reportDate: true } }))!.reportDate.toISOString().slice(0, 10)

beforeAll(async () => {
  const admin = await prisma.user.create({ data: { userCode: `TOD-A-${sfx}`, email: `tod_a_${sfx}@e.local`, passwordHash: 'x', firstName: 'A', lastName: 'D', role: 'ADMIN', status: 'ACTIVE' } })
  const sup = await prisma.user.create({ data: { userCode: `TOD-S-${sfx}`, email: `tod_s_${sfx}@e.local`, passwordHash: 'x', firstName: 'S', lastName: 'U', role: 'SUPERVISOR', status: 'ACTIVE' } })
  ids.adminId = admin.id; ids.supId = sup.id
})

afterAll(async () => {
  await prisma.dailyReport.deleteMany({ where: { project: { projectCode: { startsWith: `TOD-P` } } } })
  await prisma.project.deleteMany({ where: { projectCode: { startsWith: `TOD-P` } } })
  await prisma.user.deleteMany({ where: { id: { in: [ids.adminId, ids.supId].filter((x): x is string => Boolean(x)) } } })
  await prisma.$disconnect()
})

describe('opening date — pure bounds', () => {
  it('defaults to the day before the earliest report, or startDate when there are none', () => {
    expect(defaultOpeningDate(D('2026-03-01'), D('2026-03-10')).toISOString().slice(0, 10)).toBe('2026-03-09')
    expect(defaultOpeningDate(D('2026-04-01'), null).toISOString().slice(0, 10)).toBe('2026-04-01')
  })
  it('accepts on/after startDate and strictly before the earliest report; rejects outside', () => {
    const start = D('2026-05-01'), earliest = D('2026-05-20')
    expect(validateOpeningDate(D('2026-05-10'), start, earliest)).toBeNull() // inside
    expect(validateOpeningDate(D('2026-05-01'), start, earliest)).toBeNull() // on startDate → accepted
    expect(validateOpeningDate(D('2026-04-30'), start, earliest)).toMatch(/before the project start/i)
    expect(validateOpeningDate(D('2026-05-20'), start, earliest)).toMatch(/before the first recorded/i)
  })
})

describe('opening date — create route defaults', () => {
  it('omitting the date defaults to the day before the earliest report', async () => {
    const projectId = await makeProject('2026-03-01')
    await addReport(projectId, '2026-03-10', ids.supId!)
    actAs(ids.adminId!)
    const res = await createOpening(post(), { params: { id: projectId } })
    expect(res.status).toBe(201)
    expect(await openingDate((await res.json()).report.id)).toBe('2026-03-09')
  })

  it('a project with no reports defaults to the start date', async () => {
    const projectId = await makeProject('2026-04-01')
    actAs(ids.adminId!)
    const res = await createOpening(post(), { params: { id: projectId } })
    expect(res.status).toBe(201)
    expect(await openingDate((await res.json()).report.id)).toBe('2026-04-01')
  })
})

describe('opening date — supplied validation, collision, draft edit, immutability', () => {
  it('rejects before startDate and on/after the earliest report; accepts a valid date', async () => {
    const projectId = await makeProject('2026-06-01')
    await addReport(projectId, '2026-06-20', ids.supId!)
    actAs(ids.adminId!)
    expect((await createOpening(post({ reportDate: '2026-05-20' }), { params: { id: projectId } })).status).toBe(400) // before start
    expect((await createOpening(post({ reportDate: '2026-06-20' }), { params: { id: projectId } })).status).toBe(400) // on earliest
    const ok = await createOpening(post({ reportDate: '2026-06-10' }), { params: { id: projectId } })
    expect(ok.status).toBe(201)
    ids.boundsReportId = (await ok.json()).report.id
    expect(await openingDate(ids.boundsReportId!)).toBe('2026-06-10')
  })

  it('changes the date on a draft, then rejects an out-of-bounds change', async () => {
    actAs(ids.adminId!)
    expect((await saveReport(patch({ reportDate: '2026-06-15', subActivities: [], openingLabour: [] }), { params: { id: ids.boundsReportId! } })).status).toBe(200)
    expect(await openingDate(ids.boundsReportId!)).toBe('2026-06-15')
    expect((await saveReport(patch({ reportDate: '2026-06-25', subActivities: [] }), { params: { id: ids.boundsReportId! } })).status).toBe(400) // on/after earliest
  })

  it('a colliding date returns a readable 409, not a raw constraint error', async () => {
    const projectId = await makeProject('2026-08-01')
    await addReport(projectId, '2026-08-10', ids.adminId!) // the ADMIN already has a report here
    actAs(ids.adminId!)
    const res = await createOpening(post({ reportDate: '2026-08-10' }), { params: { id: projectId } })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/already exists/i)
  })

  it('an approved opening report has no path to change its date', async () => {
    // Lock the bounds report (approve it directly) — canEdit blocks any further PATCH.
    await prisma.dailyReport.update({ where: { id: ids.boundsReportId! }, data: { status: 'APPROVED' } })
    actAs(ids.adminId!)
    const res = await saveReport(patch({ reportDate: '2026-06-12', subActivities: [] }), { params: { id: ids.boundsReportId! } })
    expect(res.status).toBe(403)
  })
})
