import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PrismaClient } from '@prisma/client'

/**
 * Removing a project activity — the same safe rule the catalogs use.
 *
 * An activity that has never been reported against is HARD-DELETED, taking its
 * sub-activities and frozen budget rows with it. One that HAS been reported against is
 * DEACTIVATED instead, so no approved report loses the line it was written against and no
 * actual cost silently disappears from the project's AC. The route reports which happened.
 */

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(), recordAuditLog: vi.fn() }))

import { getServerSession } from 'next-auth'
import { writeAuditLog } from '@/lib/audit'
import { DELETE } from '@/app/api/activities/[id]/route'

const prisma = new PrismaClient()
const sfx = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const ids: {
  userId?: string
  projectId?: string
  reportId?: string
  unusedId?: string
  usedId?: string
  unusedSubId?: string
  masonId?: string
} = {}

const MASON = `TestDelMason-${sfx}`

function del(id: string) {
  return DELETE(new NextRequest(`http://localhost/api/activities/${id}`, { method: 'DELETE' }), { params: { id } })
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { userCode: `TSTD-U-${sfx}`, email: `tstd_${sfx}@e.local`, passwordHash: 'x', firstName: 'D', lastName: 'L', role: 'ADMIN' },
  })
  ids.userId = user.id
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: user.id } } as never)

  const mason = await prisma.laborCategory.create({ data: { name: MASON, hourlyRate: 2 } })
  ids.masonId = mason.id

  const project = await prisma.project.create({
    data: { projectCode: `TSTD-P-${sfx}`, name: `Delete ${sfx}`, status: 'ACTIVE', createdBy: user.id },
  })
  ids.projectId = project.id
  const asset = await prisma.asset.create({ data: { projectId: project.id, name: 'Villa A' } })

  // (a) never reported against — carries a sub-activity AND a frozen budget row, so the
  //     test proves the cascade takes those with it rather than orphaning them.
  const unused = await prisma.activity.create({
    data: {
      assetId: asset.id, name: 'Stray EIFS', type: 'MEASURED', unit: 'm2', boqQuantity: 100,
      subActivities: {
        create: [{
          name: 'Base coat', type: 'MEASURED', sortOrder: 0,
          manpowerBudget: { create: [{ laborCategoryId: mason.id, hoursPerUnit: 0.3, costRateAtPlacement: 2 }] },
        }],
      },
    },
    select: { id: true, subActivities: { select: { id: true } } },
  })
  ids.unusedId = unused.id
  ids.unusedSubId = unused.subActivities[0]!.id

  // (b) reported against on an approved report.
  const used = await prisma.activity.create({
    data: {
      assetId: asset.id, name: 'Reported EIFS', type: 'MEASURED', unit: 'm2', boqQuantity: 100,
      subActivities: { create: [{ name: 'Base coat', type: 'MEASURED', sortOrder: 0 }] },
    },
    select: { id: true, subActivities: { select: { id: true } } },
  })
  ids.usedId = used.id

  const report = await prisma.dailyReport.create({
    data: {
      reportCode: `TSTD-R-${sfx}`, projectId: project.id, authorId: user.id,
      reportDate: new Date('2026-07-01'), status: 'APPROVED',
      activities: {
        create: [{
          activityId: used.id,
          subActivities: { create: [{ subActivityId: used.subActivities[0]!.id, quantityDone: 25 }] },
        }],
      },
    },
  })
  ids.reportId = report.id
})

afterAll(async () => {
  if (ids.reportId) await prisma.dailyReport.deleteMany({ where: { id: ids.reportId } })
  if (ids.projectId) await prisma.project.deleteMany({ where: { id: ids.projectId } })
  await prisma.laborCategory.deleteMany({ where: { name: MASON } })
  if (ids.userId) await prisma.user.deleteMany({ where: { id: ids.userId } })
  await prisma.$disconnect()
})

describe('activity removal — hard-delete when unused', () => {
  it('hard-deletes an activity that has never been reported against', async () => {
    const res = await del(ids.unusedId!)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ ok: true, deleted: true })
    expect(await prisma.activity.findUnique({ where: { id: ids.unusedId! } })).toBeNull()
  })

  it('takes the sub-activities and frozen budget rows with it', async () => {
    expect(await prisma.subActivity.findUnique({ where: { id: ids.unusedSubId! } })).toBeNull()
    expect(await prisma.subActivityManpowerBudget.count({ where: { subActivityId: ids.unusedSubId! } })).toBe(0)
  })

  it('audits the delete', () => {
    expect(vi.mocked(writeAuditLog)).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ACTIVITY_DELETED', entityId: ids.unusedId }),
    )
  })
})

describe('activity removal — deactivate when referenced', () => {
  it('deactivates rather than deletes an activity that has been reported against', async () => {
    const res = await del(ids.usedId!)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, deactivated: true })
    expect(body.deleted).toBeUndefined()
    // It says WHY: one ReportActivity group and one reported sub-activity line.
    expect(body.references).toEqual({ reportActivities: 1, reportedSubActivities: 1 })
  })

  it('leaves the activity and its reported history intact', async () => {
    const still = await prisma.activity.findUnique({ where: { id: ids.usedId! }, select: { isActive: true } })
    expect(still).not.toBeNull()
    expect(still!.isActive).toBe(false)
    expect(await prisma.reportActivity.count({ where: { activityId: ids.usedId! } })).toBe(1)
  })
})

describe('activity removal — guards', () => {
  it('404s on an unknown activity', async () => {
    const res = await del('does-not-exist')
    expect(res.status).toBe(404)
  })

  it('rejects a non-admin', async () => {
    const viewer = await prisma.user.create({
      data: { userCode: `TSTD-V-${sfx}`, email: `tstdv_${sfx}@e.local`, passwordHash: 'x', firstName: 'V', lastName: 'R', role: 'VIEWER' },
    })
    vi.mocked(getServerSession).mockResolvedValueOnce({ user: { id: viewer.id } } as never)
    const res = await del(ids.usedId!)
    expect(res.status).toBe(403)
    await prisma.user.delete({ where: { id: viewer.id } })
  })
})
