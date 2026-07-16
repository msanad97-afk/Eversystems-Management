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
