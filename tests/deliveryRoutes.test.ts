import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Role, ReportStatus } from '@prisma/client'

// Invoke the real route handlers in isolation with mocked auth + DB.
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/audit', () => ({ writeAuditLog: vi.fn(), recordAuditLog: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    dailyReport: { findUnique: vi.fn() },
    delivery: { findUnique: vi.fn(), delete: vi.fn().mockResolvedValue({}) },
    projectMember: { findMany: vi.fn().mockResolvedValue([]) },
    inventoryAlert: { findMany: vi.fn().mockResolvedValue([]) },
    material: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(),
  },
}))

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { GET as alertsGet } from '@/app/api/inventory-alerts/route'
import { POST as createDelivery } from '@/app/api/reports/[id]/deliveries/route'
import { DELETE as deleteDelivery } from '@/app/api/reports/[id]/deliveries/[deliveryId]/route'

const USER_ID = 'user-1'

function actAs(role: Role, id = USER_ID) {
  vi.mocked(getServerSession).mockResolvedValue({ user: { id } } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    id, email: 'u@e.local', userCode: 'USR-1', firstName: 'U', lastName: 'One', role, status: 'ACTIVE', mustChangePassword: false,
  } as never)
}
const req = (body?: unknown, method = 'POST') =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new Request('http://test/x', { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }) as any

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.projectMember.findMany).mockResolvedValue([] as never)
  vi.mocked(prisma.$transaction).mockImplementation(((fn: (tx: typeof prisma) => unknown) => fn(prisma)) as never)
})

describe('inventory alerts endpoint is ADMIN-only', () => {
  it('rejects a SUPERVISOR (403), enforced in the route not just the UI', async () => {
    actAs('SUPERVISOR')
    const res = await alertsGet(req(undefined, 'GET'))
    expect(res.status).toBe(403)
  })

  it('allows an ADMIN (200)', async () => {
    actAs('ADMIN')
    const res = await alertsGet(req(undefined, 'GET'))
    expect(res.status).toBe(200)
  })
})

describe('deliveries are immutable once the report is reviewed', () => {
  it('POST delivery to an APPROVED report is rejected (409)', async () => {
    actAs('SUPERVISOR')
    vi.mocked(prisma.dailyReport.findUnique).mockResolvedValue({
      id: 'r1', authorId: USER_ID, projectId: 'p1', status: 'APPROVED' as ReportStatus, reportCode: 'DR-1',
    } as never)
    const res = await createDelivery(req({ supplierName: 'X', deliveryNoteNumber: 'DN', lines: [{ materialId: 'm1', quantity: 1 }] }), { params: { id: 'r1' } })
    expect(res.status).toBe(409)
  })

  it('DELETE delivery on an APPROVED report is rejected (409)', async () => {
    actAs('SUPERVISOR')
    vi.mocked(prisma.delivery.findUnique).mockResolvedValue({
      id: 'd1', dailyReportId: 'r1', dailyReport: { id: 'r1', authorId: USER_ID, projectId: 'p1', status: 'APPROVED' as ReportStatus, reportCode: 'DR-1' },
    } as never)
    const res = await deleteDelivery(req(undefined, 'DELETE'), { params: { id: 'r1', deliveryId: 'd1' } })
    expect(res.status).toBe(409)
    expect(vi.mocked(prisma.delivery.delete)).not.toHaveBeenCalled()
  })
})
