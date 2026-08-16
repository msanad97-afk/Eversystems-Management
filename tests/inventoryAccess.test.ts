import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Role } from '@prisma/client'

// The inventory page is ADMIN-only, enforced server-side (not just hidden from the nav). A
// supervisor (or an unauthenticated visitor) hitting it is redirected away before any data loads.
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`) }),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    project: { findMany: vi.fn().mockResolvedValue([]) },
    deliveryLine: { findMany: vi.fn().mockResolvedValue([]) },
    consumptionEntry: { groupBy: vi.fn().mockResolvedValue([]) },
    stockCountLine: { findMany: vi.fn().mockResolvedValue([]) },
    material: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))

import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import AdminInventoryPage from '@/app/(app)/admin/inventory/page'

function actAs(role: Role | null) {
  if (role === null) {
    vi.mocked(getServerSession).mockResolvedValue(null as never)
    return
  }
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    id: 'u1', email: 'u@e.local', userCode: 'USR-1', firstName: 'U', lastName: 'One',
    role, status: 'ACTIVE', mustChangePassword: false,
  } as never)
}

const render = () => AdminInventoryPage({ searchParams: {} })

beforeEach(() => vi.clearAllMocks())

describe('inventory page — ADMIN only', () => {
  it('redirects a SUPERVISOR to /', async () => {
    actAs('SUPERVISOR')
    await expect(render()).rejects.toThrow('REDIRECT:/')
  })

  it('redirects an unauthenticated visitor to /login', async () => {
    actAs(null)
    await expect(render()).rejects.toThrow('REDIRECT:/login')
  })

  it('an ADMIN passes the guard (no redirect thrown)', async () => {
    actAs('ADMIN')
    // requireAdminPage returns the user without redirecting; loadInventory then runs against the
    // mocked prisma (no projects → no balance query). We assert only that no redirect fired.
    await render().catch((e) => { if (e instanceof Error && e.message.startsWith('REDIRECT:')) throw e })
    expect(vi.mocked(redirect)).not.toHaveBeenCalled()
  })
})
