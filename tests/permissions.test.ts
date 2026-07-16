import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Role, UserStatus } from '@prisma/client'

// Mock the JWT session source and the database, so we can prove that role/status are
// re-validated against the DB on every call — independent of what the JWT claims.
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: vi.fn() } } }))

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import {
  getSessionUser,
  requireUser,
  requireRole,
  requireAdmin,
} from '@/lib/auth/permissions'

const dbUser = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'u1',
  email: 'u@e.local',
  userCode: 'USR-00009',
  firstName: 'U',
  lastName: 'One',
  role: 'SUPERVISOR' as Role,
  status: 'ACTIVE' as UserStatus,
  mustChangePassword: false,
  ...over,
})

function setSession(id: string | null) {
  vi.mocked(getServerSession).mockResolvedValue(id ? ({ user: { id } } as never) : null)
}
function setDbUser(user: unknown) {
  vi.mocked(prisma.user.findUnique).mockResolvedValue(user as never)
}
async function statusOf(guard: { error: { status: number } } | { user: unknown }) {
  return 'error' in guard ? guard.error.status : 200
}

beforeEach(() => vi.clearAllMocks())

describe('getSessionUser re-validation', () => {
  it('returns null when there is no session', async () => {
    setSession(null)
    expect(await getSessionUser()).toBeNull()
  })

  it('returns null when the DB user no longer exists', async () => {
    setSession('u1')
    setDbUser(null)
    expect(await getSessionUser()).toBeNull()
  })

  it('rejects a live session whose user was deactivated (status INACTIVE)', async () => {
    // Same valid JWT (session present), but the DB now says INACTIVE.
    setSession('u1')
    setDbUser(dbUser({ status: 'INACTIVE' }))
    expect(await getSessionUser()).toBeNull()

    const guard = await requireUser()
    expect(await statusOf(guard)).toBe(401)
  })

  it('reflects a role changed in the DB, not the stale JWT', async () => {
    // JWT identifies u1; DB says ADMIN now.
    setSession('u1')
    setDbUser(dbUser({ role: 'ADMIN' }))
    const user = await getSessionUser()
    expect(user?.role).toBe('ADMIN')
  })
})

describe('requireRole / requireAdmin', () => {
  it('403s when the DB role is not permitted', async () => {
    setSession('u1')
    setDbUser(dbUser({ role: 'SUPERVISOR' }))
    expect(await statusOf(await requireAdmin())).toBe(403)
  })

  it('allows when the DB role matches', async () => {
    setSession('u1')
    setDbUser(dbUser({ role: 'ADMIN' }))
    expect(await statusOf(await requireAdmin())).toBe(200)
    expect(await statusOf(await requireRole('ADMIN', 'VIEWER'))).toBe(200)
  })
})

describe('mustChangePassword enforcement (applies to API routes)', () => {
  it('403s a flagged user on a normal route', async () => {
    setSession('u1')
    setDbUser(dbUser({ mustChangePassword: true }))
    expect(await statusOf(await requireUser())).toBe(403)
  })

  it('lets a flagged user through only when allowPasswordChange is set', async () => {
    setSession('u1')
    setDbUser(dbUser({ mustChangePassword: true }))
    expect(await statusOf(await requireUser({ allowPasswordChange: true }))).toBe(200)
  })

  it('does not block an unflagged user', async () => {
    setSession('u1')
    setDbUser(dbUser({ mustChangePassword: false }))
    expect(await statusOf(await requireUser())).toBe(200)
  })
})
