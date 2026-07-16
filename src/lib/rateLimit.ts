import type { AuditAction } from '@prisma/client'

/**
 * Login rate limiting WITHOUT extra infrastructure (no Redis, schema is frozen).
 * We count recent USER_LOGIN_FAILED audit rows within a sliding window, per account
 * and per IP. Failed logins are recorded with an awaited audit write, so sequential
 * brute-force attempts reliably observe prior failures.
 *
 * Note: a blocked attempt does NOT itself record a failure, so the window ages out —
 * an attacker cannot keep an account locked indefinitely by continuing to hammer it.
 * Under highly concurrent bursts the count can momentarily race (no atomic counter
 * without Redis); the common sequential case is enforced correctly.
 */

export const LOGIN_WINDOW_MS = 15 * 60 * 1000 // 15 minutes
export const ACCOUNT_FAIL_LIMIT = 5
export const IP_FAIL_LIMIT = 30

/** Fixed delay applied before returning a failed-login response (slows brute force). */
export const FAILED_LOGIN_DELAY_MS = 1000

export function loginDelay(ms: number = FAILED_LOGIN_DELAY_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Per-account in-flight lock. The count-then-check limiter above is not atomic, so a
 * concurrent BURST of attempts for the same account could each read a below-threshold
 * count before any failure is recorded. Serialising by account closes that window: a
 * second concurrent attempt for the same key is rejected immediately while the first
 * is in flight (and the first is deliberately slowed by loginDelay on failure).
 *
 * RESIDUAL LIMITATION: this lock and the audit-count limiter both live in the app
 * process (no Redis, schema frozen). In a MULTI-INSTANCE deployment attempts can land
 * on different instances, so the lock does not serialise across the fleet and the
 * count can still race slightly at the per-instance boundary. Distributed correctness
 * would require a shared atomic store (Redis INCR / a DB advisory lock) — deferred with
 * the rest of the Redis-free trade-off. Single-instance deployments are fully covered.
 */
const inFlightAccounts = new Set<string>()

/** Returns true if the lock was acquired; false if an attempt is already in flight. */
export function acquireLoginLock(key: string): boolean {
  if (inFlightAccounts.has(key)) return false
  inFlightAccounts.add(key)
  return true
}

export function releaseLoginLock(key: string): void {
  inFlightAccounts.delete(key)
}

export type RateLimitScope = 'account' | 'ip'
export interface RateLimitResult {
  blocked: boolean
  scope?: RateLimitScope
}

/** Minimal surface of the Prisma client this needs — keeps it easy to unit test. */
export interface AuditCounter {
  auditLog: {
    count(args: {
      where: {
        action: AuditAction
        userId?: string
        ipAddress?: string
        createdAt: { gte: Date }
      }
    }): Promise<number>
  }
}

export async function checkLoginRateLimit(
  db: AuditCounter,
  params: { userId?: string | null; ipAddress?: string | null; now?: Date },
): Promise<RateLimitResult> {
  const now = params.now ?? new Date()
  const gte = new Date(now.getTime() - LOGIN_WINDOW_MS)

  const [accountFails, ipFails] = await Promise.all([
    params.userId
      ? db.auditLog.count({ where: { action: 'USER_LOGIN_FAILED', userId: params.userId, createdAt: { gte } } })
      : Promise.resolve(0),
    params.ipAddress
      ? db.auditLog.count({ where: { action: 'USER_LOGIN_FAILED', ipAddress: params.ipAddress, createdAt: { gte } } })
      : Promise.resolve(0),
  ])

  if (params.userId && accountFails >= ACCOUNT_FAIL_LIMIT) return { blocked: true, scope: 'account' }
  if (params.ipAddress && ipFails >= IP_FAIL_LIMIT) return { blocked: true, scope: 'ip' }
  return { blocked: false }
}
