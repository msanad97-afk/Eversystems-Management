import { describe, it, expect } from 'vitest'
import {
  checkLoginRateLimit,
  ACCOUNT_FAIL_LIMIT,
  IP_FAIL_LIMIT,
  FAILED_LOGIN_DELAY_MS,
  acquireLoginLock,
  releaseLoginLock,
  type AuditCounter,
} from '@/lib/rateLimit'

/** Builds a fake counter returning fixed counts for account (userId) and ip queries. */
function counter(accountCount: number, ipCount: number): AuditCounter {
  return {
    auditLog: {
      count: async ({ where }) => {
        if (where.userId !== undefined) return accountCount
        if (where.ipAddress !== undefined) return ipCount
        return 0
      },
    },
  }
}

describe('checkLoginRateLimit', () => {
  it('does not block below either threshold', async () => {
    const r = await checkLoginRateLimit(counter(ACCOUNT_FAIL_LIMIT - 1, IP_FAIL_LIMIT - 1), {
      userId: 'u1',
      ipAddress: '1.2.3.4',
    })
    expect(r.blocked).toBe(false)
  })

  it('blocks per-account at the account limit', async () => {
    const r = await checkLoginRateLimit(counter(ACCOUNT_FAIL_LIMIT, 0), {
      userId: 'u1',
      ipAddress: '1.2.3.4',
    })
    expect(r.blocked).toBe(true)
    expect(r.scope).toBe('account')
  })

  it('blocks per-IP at the IP limit even for an unknown account', async () => {
    const r = await checkLoginRateLimit(counter(0, IP_FAIL_LIMIT), {
      userId: null,
      ipAddress: '1.2.3.4',
    })
    expect(r.blocked).toBe(true)
    expect(r.scope).toBe('ip')
  })

  it('does not apply the account limit when there is no userId (unknown email)', async () => {
    const r = await checkLoginRateLimit(counter(999, 0), { userId: null, ipAddress: '1.2.3.4' })
    expect(r.blocked).toBe(false)
  })

  it('does nothing when neither userId nor ip is provided', async () => {
    const r = await checkLoginRateLimit(counter(999, 999), {})
    expect(r.blocked).toBe(false)
  })
})

describe('in-flight login lock (anti-concurrency)', () => {
  it('rejects a second concurrent attempt for the same account, then frees on release', () => {
    expect(acquireLoginLock('a@e.local')).toBe(true)
    expect(acquireLoginLock('a@e.local')).toBe(false) // already in flight
    releaseLoginLock('a@e.local')
    expect(acquireLoginLock('a@e.local')).toBe(true)
    releaseLoginLock('a@e.local')
  })

  it('locks are independent per account', () => {
    expect(acquireLoginLock('x@e.local')).toBe(true)
    expect(acquireLoginLock('y@e.local')).toBe(true)
    releaseLoginLock('x@e.local')
    releaseLoginLock('y@e.local')
  })

  it('applies a non-zero failure delay', () => {
    expect(FAILED_LOGIN_DELAY_MS).toBeGreaterThan(0)
  })
})
