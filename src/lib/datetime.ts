/**
 * App date/time conventions — single source of truth.
 *
 * The business operates in Bahrain (UTC+3, no DST). "Today" and every date-boundary
 * calculation must be evaluated in this timezone, otherwise between 00:00 and 03:00
 * local the app would be a calendar day behind (UTC still shows yesterday).
 *
 * STORAGE CONVENTION: `@db.Date` columns store a *civil* (Bahrain-local) calendar date
 * with no time. In JavaScript we represent that civil date as UTC midnight of the same
 * Y-M-D (e.g. civil 2026-07-14 → `2026-07-14T00:00:00.000Z`). Always build these Dates
 * via `civilMidnightUtc()` and always derive "today" via `startOfAppDay()` so that
 * report dates AND Phase 6 monthly EVM buckets share one drift-free convention.
 */

export const APP_TIMEZONE = 'Asia/Bahrain'

const MS_PER_DAY = 86_400_000

/** The civil (calendar) date, as 'YYYY-MM-DD', of an instant in the app timezone. */
export function civilDateString(instant: Date = new Date(), tz: string = APP_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Converts a 'YYYY-MM-DD' civil date to its stored/comparable UTC-midnight Date. */
export function civilMidnightUtc(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`)
}

/** Normalises any Date to UTC midnight (used to compare civil-date representations). */
export function toUtcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/** Today (in the app timezone) as a UTC-midnight Date. */
export function startOfAppDay(instant: Date = new Date()): Date {
  return civilMidnightUtc(civilDateString(instant))
}

/** Today (in the app timezone) as 'YYYY-MM-DD'. */
export function todayCivilString(instant: Date = new Date()): string {
  return civilDateString(instant)
}

/** Whole-day difference a − b (both treated as civil-date representations). */
export function diffInDays(a: Date, b: Date): number {
  return Math.round((toUtcMidnight(a).getTime() - toUtcMidnight(b).getTime()) / MS_PER_DAY)
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * MS_PER_DAY)
}

/** Civil date (YYYY-MM-DD) of the Saturday that starts the current app-week (Gulf weekend). */
export function weekStartSaturday(instant: Date = new Date()): string {
  const todayMid = startOfAppDay(instant)
  const daysSinceSat = (todayMid.getUTCDay() - 6 + 7) % 7 // 0=Sun … 6=Sat
  return addDays(todayMid, -daysSinceSat).toISOString().slice(0, 10)
}
