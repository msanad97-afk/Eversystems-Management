import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { Role } from '@prisma/client'

// Auth + data mocked so we assert the guards only: the cron's CRON_SECRET bearer and the on-demand
// endpoint's ADMIN-only rule (this document carries money — a supervisor must be refused).
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: vi.fn() } } }))

import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { GET as cronGet } from '@/app/api/cron/weekly-summary/route'
import { GET as onDemandGet } from '@/app/api/admin/weekly-summary/route'

function actAs(role: Role) {
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1' } } as never)
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    id: 'u1', email: 'u@e.local', userCode: 'USR-1', firstName: 'U', lastName: 'One',
    role, status: 'ACTIVE', mustChangePassword: false,
  } as never)
}
const req = (headers?: Record<string, string>) => new NextRequest('http://test/api/x', { headers })

let savedSecret: string | undefined
beforeEach(() => {
  vi.clearAllMocks()
  savedSecret = process.env.CRON_SECRET
  process.env.CRON_SECRET = 'test-secret'
})
afterEach(() => {
  if (savedSecret === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = savedSecret
})

describe('weekly-summary cron — CRON_SECRET bearer', () => {
  it('fails closed with 401 when the bearer is missing', async () => {
    const res = await cronGet(req())
    expect(res.status).toBe(401)
  })

  it('fails closed with 401 on a wrong bearer', async () => {
    const res = await cronGet(req({ authorization: 'Bearer wrong' }))
    expect(res.status).toBe(401)
  })
})

describe('on-demand weekly-summary — ADMIN only', () => {
  it('refuses a SUPERVISOR with 403', async () => {
    actAs('SUPERVISOR')
    const res = await onDemandGet(req())
    expect(res.status).toBe(403)
  })
})
