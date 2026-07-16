import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { redirect } from 'next/navigation'
import type { Role } from '@prisma/client'
import { authOptions } from '@/lib/auth/options'
import { prisma } from '@/lib/prisma'
import type { SessionUser } from '@/types/next-auth'

/**
 * Resolves the current user by RE-VALIDATING the JWT session against the database
 * on every call. The JWT is only used to identify the user id; role, status and
 * mustChangePassword are always read fresh from the DB, so a session goes stale the
 * moment an admin deactivates the user, changes their role, or resets their password.
 * A missing or non-ACTIVE user resolves to null (i.e. the live session is rejected).
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions)
  const id = session?.user?.id
  if (!id) return null

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      userCode: true,
      firstName: true,
      lastName: true,
      role: true,
      status: true,
      mustChangePassword: true,
    },
  })

  if (!user || user.status !== 'ACTIVE') return null
  return user
}

export function jsonError(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status })
}

type Guard = { user: SessionUser } | { error: NextResponse }

interface GuardOptions {
  /** Allow a user flagged mustChangePassword through (only the password-change route). */
  allowPasswordChange?: boolean
}

async function baseGuard(opts?: GuardOptions): Promise<Guard> {
  const user = await getSessionUser()
  if (!user) return { error: jsonError(401, 'Not authenticated.') }
  if (user.mustChangePassword && !opts?.allowPasswordChange) {
    return { error: jsonError(403, 'You must set a new password before continuing.') }
  }
  return { user }
}

/** Require any authenticated, active user (blocked while mustChangePassword unless allowed). */
export function requireUser(opts?: GuardOptions): Promise<Guard> {
  return baseGuard(opts)
}

/** Require an authenticated, active user whose role is in `roles`. */
export async function requireRole(...roles: Role[]): Promise<Guard> {
  const guard = await baseGuard()
  if ('error' in guard) return guard
  if (!roles.includes(guard.user.role)) return { error: jsonError(403, 'Forbidden.') }
  return guard
}

/** Require an ADMIN. */
export function requireAdmin(): Promise<Guard> {
  return requireRole('ADMIN')
}

/** Server-component guard: redirects instead of returning JSON. Re-validates role fresh. */
export async function requireAdminPage(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  if (user.role !== 'ADMIN') redirect('/')
  return user
}

/** Server-component guard allowing any of `roles`; redirects otherwise. Role read fresh. */
export async function requireRolePage(...roles: Role[]): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  if (!roles.includes(user.role)) redirect('/')
  return user
}

export function isAdmin(user: SessionUser | null): boolean {
  return user?.role === 'ADMIN'
}
