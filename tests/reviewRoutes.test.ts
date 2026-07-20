import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReportStatus, Role } from '@prisma/client'

// Mock auth source, DB, and audit so we can invoke the real route handlers in isolation.
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(), recordAuditLog: vi.fn() }))
vi.mock('@/lib/notifications', () => ({ notifyReportSubmitted: vi.fn(), notifyReportReviewed: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    dailyReport: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
    projectMember: { findMany: vi.fn().mockResolvedValue([]) },
    activity: { findMany: vi.fn().mockResolvedValue([]) },
    subActivity: { findMany: vi.fn().mockResolvedValue([]) },
    reportActivity: { groupBy: vi.fn().mockResolvedValue([]) },
    reportSubActivity: { groupBy: vi.fn().mockResolvedValue([]), findMany: vi.fn().mockResolvedValue([]) },
  },
}))

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { POST as approve } from '@/app/api/reports/[id]/approve/route'
import { POST as reject } from '@/app/api/reports/[id]/reject/route'
import { POST as submit } from '@/app/api/reports/[id]/submit/route'
import { PATCH as patchReport } from '@/app/api/reports/[id]/route'
import { POST as createReport } from '@/app/api/reports/route'

const USER_ID = 'user-1'

function actAs(role: Role, id = USER_ID) {
  vi.mocked(getServerSession).mockResolvedValue({ user: { id } } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    id, email: 'u@e.local', userCode: 'USR-1', firstName: 'U', lastName: 'One',
    role, status: 'ACTIVE', mustChangePassword: false,
  } as never)
}
function reportIs(over: Record<string, unknown>) {
  vi.mocked(prisma.dailyReport.findUnique).mockResolvedValue({
    id: 'r1', reportCode: 'DR-2026-0001', projectId: 'p1', authorId: USER_ID,
    status: 'SUBMITTED' as ReportStatus, ...over,
  } as never)
}
const req = (body?: unknown) =>
  new Request('http://test/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any
const params = { params: { id: 'r1' } }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.dailyReport.update).mockResolvedValue({} as never)
  vi.mocked(prisma.projectMember.findMany).mockResolvedValue([] as never)
})

describe('approve route', () => {
  it('approves a SUBMITTED report and locks it (status APPROVED, reviewer stamped)', async () => {
    actAs('ADMIN')
    reportIs({ status: 'SUBMITTED' })
    const res = await approve(req(), params)
    expect(res.status).toBe(200)
    const data = vi.mocked(prisma.dailyReport.update).mock.calls[0]![0].data
    expect(data.status).toBe('APPROVED')
    expect(data.reviewedById).toBe(USER_ID)
  })

  it('refuses to approve a non-SUBMITTED report (already APPROVED → 409): approve is permanent', async () => {
    actAs('ADMIN')
    reportIs({ status: 'APPROVED' })
    const res = await approve(req(), params)
    expect(res.status).toBe(409)
    expect(prisma.dailyReport.update).not.toHaveBeenCalled()
  })

  it('VIEWER cannot approve (403)', async () => {
    actAs('VIEWER')
    reportIs({ status: 'SUBMITTED' })
    expect((await approve(req(), params)).status).toBe(403)
  })
})

describe('reject route', () => {
  it('requires a note (400 without one)', async () => {
    actAs('ADMIN')
    reportIs({ status: 'SUBMITTED' })
    expect((await reject(req({}), params)).status).toBe(400)
    expect((await reject(req({ note: '   ' }), params)).status).toBe(400)
    expect(prisma.dailyReport.update).not.toHaveBeenCalled()
  })

  it('rejects a SUBMITTED report with a note', async () => {
    actAs('ADMIN')
    reportIs({ status: 'SUBMITTED' })
    const res = await reject(req({ note: 'Fix the rebar count' }), params)
    expect(res.status).toBe(200)
    const data = vi.mocked(prisma.dailyReport.update).mock.calls[0]![0].data
    expect(data.status).toBe('REJECTED')
    expect(data.reviewNote).toBe('Fix the rebar count')
  })

  it('VIEWER cannot reject (403)', async () => {
    actAs('VIEWER')
    reportIs({ status: 'SUBMITTED' })
    expect((await reject(req({ note: 'x' }), params)).status).toBe(403)
  })
})

describe('submit route — resubmit clears the prior review', () => {
  it('clears reviewedById/reviewedAt/reviewNote when resubmitting a REJECTED report', async () => {
    actAs('SUPERVISOR')
    reportIs({
      status: 'REJECTED',
      reviewNote: 'previous note',
      activities: [
        {
          subActivities: [
            {
              subActivityId: 'sub1',
              quantityDone: 5,
              percentComplete: null,
              subActivity: { name: 'Blockwork 200mm', type: 'MEASURED', activity: { unit: 'm2' } },
              manpower: [{ categoryId: 'c1', headcount: 5, hours: 8 }],
              materials: [],
            },
          ],
        },
      ],
    })
    // Cap: sub boq 500, no committed elsewhere → remaining 500 (qty 5 is fine).
    vi.mocked(prisma.subActivity.findMany).mockResolvedValue([{ id: 'sub1', type: 'MEASURED', activity: { boqQuantity: 500 } }] as never)
    vi.mocked(prisma.reportSubActivity.groupBy).mockResolvedValue([] as never)

    const res = await submit(req(), params)
    expect(res.status).toBe(200)
    const data = vi.mocked(prisma.dailyReport.update).mock.calls[0]![0].data
    expect(data.status).toBe('SUBMITTED')
    expect(data.reviewedById).toBeNull()
    expect(data.reviewedAt).toBeNull()
    expect(data.reviewNote).toBeNull()
  })

  it('VIEWER cannot submit a report (403 — not the author)', async () => {
    actAs('VIEWER')
    reportIs({ status: 'DRAFT', authorId: 'someone-else', activities: [] })
    expect((await submit(req(), params)).status).toBe(403)
  })
})

describe('mutations blocked after approval / for viewers', () => {
  it('editing an APPROVED report is blocked (403) — approve locks permanently', async () => {
    actAs('SUPERVISOR')
    reportIs({ status: 'APPROVED', authorId: USER_ID })
    const res = await patchReport(req({ generalNotes: 'late edit' }), params)
    expect(res.status).toBe(403)
    expect(prisma.dailyReport.update).not.toHaveBeenCalled()
  })

  it('VIEWER cannot create a report (403)', async () => {
    actAs('VIEWER')
    const res = await createReport(req({ projectId: 'p1', reportDate: '2026-07-14' }))
    expect(res.status).toBe(403)
  })
})
