import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Role } from '@prisma/client'

// The admin project page (which renders the overview breakdown) is ADMIN-only, enforced server-side.
// A supervisor never sees the money block: requireAdminPage() redirects before any loader runs.
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`) }),
  notFound: vi.fn(() => { throw new Error('NOT_FOUND') }),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: vi.fn() }, project: { findUnique: vi.fn() } },
}))

import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import ProjectDetailPage from '@/app/(app)/admin/projects/[id]/page'

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

const render = () => ProjectDetailPage({ params: { id: 'p1' } })

beforeEach(() => vi.clearAllMocks())

describe('admin project page (overview breakdown) — ADMIN only', () => {
  it('redirects a SUPERVISOR to / before any loader runs', async () => {
    actAs('SUPERVISOR')
    await expect(render()).rejects.toThrow('REDIRECT:/')
    expect(vi.mocked(prisma.project.findUnique)).not.toHaveBeenCalled()
  })

  it('redirects an unauthenticated visitor to /login', async () => {
    actAs(null)
    await expect(render()).rejects.toThrow('REDIRECT:/login')
  })
})
