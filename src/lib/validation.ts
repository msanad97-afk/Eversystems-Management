import { Role, UserStatus, ProjectStatus } from '@prisma/client'

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

export function normalizeEmail(v: string): string {
  return v.trim().toLowerCase()
}

export function isEmail(v: unknown): v is string {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())
}

export function isRole(v: unknown): v is Role {
  return typeof v === 'string' && (Object.values(Role) as string[]).includes(v)
}

export function isUserStatus(v: unknown): v is UserStatus {
  return typeof v === 'string' && (Object.values(UserStatus) as string[]).includes(v)
}

export function isProjectStatus(v: unknown): v is ProjectStatus {
  return typeof v === 'string' && (Object.values(ProjectStatus) as string[]).includes(v)
}

export function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

/** Returns a de-duplicated string[] from an unknown value, or null if it isn't an array of strings. */
export function toIdArray(v: unknown): string[] | null {
  if (!isStringArray(v)) return null
  return Array.from(new Set(v))
}

/** Parses a YYYY-MM-DD (or ISO) date string to a Date, or null if invalid/empty. */
export function parseDate(v: unknown): Date | null {
  if (typeof v !== 'string' || v.trim() === '') return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Header-financial parsers (Phase 6E-pre). Each mirrors the route's existing `money()`
 * convention: `null` = "cleared / none agreed" (empty or explicit null), a valid value, or
 * `undefined` = INVALID so the caller can 400 with a named field. Never throws.
 */

/** A percentage: null, or a finite number in [0, 100]. */
export function parsePercent(v: unknown): number | null | undefined {
  if (v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : undefined
}

/** A non-negative whole number of days: null, or an integer ≥ 0. */
export function parseNonNegativeInt(v: unknown): number | null | undefined {
  if (v === null || v === '') return null
  const n = Number(v)
  return Number.isInteger(n) && n >= 0 ? n : undefined
}

/**
 * A currency code — non-null on the model (default BHD), so null is NOT allowed here; empty
 * clears back to the default. Normalised to an upper-case 3-letter code. Single-currency
 * assumption: this is validated as a code, not reconciled against BankAccount.currency.
 */
export function parseCurrency(v: unknown): string | undefined {
  if (v === null || v === '' || v === undefined) return 'BHD'
  if (typeof v !== 'string') return undefined
  const code = v.trim().toUpperCase()
  return /^[A-Z]{3}$/.test(code) ? code : undefined
}
