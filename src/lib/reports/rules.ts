import type { ReportStatus } from '@prisma/client'
import { startOfAppDay, toUtcMidnight, diffInDays } from '@/lib/datetime'

/**
 * Daily-report business rules. Pure functions with no I/O so every rule is
 * unit-testable and there is a single source of truth for each. (Phase R: the report
 * body is now activity-structured — quantity done per activity, with manpower/materials
 * nested under each activity.)
 */

/** Max days a report may be backdated (spec: configurable constant). */
export const MAX_BACKDATE_DAYS = 7

export const WEATHER_OPTIONS = ['Clear', 'Hot', 'Dusty', 'Windy', 'Rain', 'Other'] as const
export type Weather = (typeof WEATHER_OPTIONS)[number]

/** Small tolerance for decimal-quantity comparisons. */
const EPS = 1e-6

/**
 * Validates a report date: future dates are never allowed; backdating is capped at
 * MAX_BACKDATE_DAYS, evaluated in the app timezone (Bahrain).
 */
export function validateReportDate(reportDate: Date, now: Date = new Date()): string | null {
  const d = toUtcMidnight(reportDate)
  const t = startOfAppDay(now)
  if (Number.isNaN(d.getTime())) return 'Invalid date.'
  if (d.getTime() > t.getTime()) return 'Future dates are not allowed.'
  const diffDays = diffInDays(t, d)
  if (diffDays > MAX_BACKDATE_DAYS) {
    return `Reports can be backdated at most ${MAX_BACKDATE_DAYS} days.`
  }
  return null
}

// ─── Status lifecycle ────────────────────────────────────────────────────────
// DRAFT → SUBMITTED → APPROVED | REJECTED ; SUBMITTED → DRAFT (recall) ;
// REJECTED → SUBMITTED (resubmit) ; APPROVED is immutable.

/** An author may edit (PATCH) only DRAFT or REJECTED reports. */
export function canEdit(status: ReportStatus): boolean {
  return status === 'DRAFT' || status === 'REJECTED'
}
/** An author may submit a DRAFT or a REJECTED (resubmit) report. */
export function canSubmit(status: ReportStatus): boolean {
  return status === 'DRAFT' || status === 'REJECTED'
}
/** An author may recall a SUBMITTED report back to DRAFT before review. */
export function canRecall(status: ReportStatus): boolean {
  return status === 'SUBMITTED'
}
/** An admin may approve or reject only a SUBMITTED report (APPROVED is permanent). */
export function canReview(status: ReportStatus): boolean {
  return status === 'SUBMITTED'
}

// ─── Report content (activity-structured) ─────────────────────────────────────

export interface ManpowerInput {
  categoryId: string
  headcount: number
  hours: number
}
export interface MaterialInput {
  materialId: string
  quantity: number
}
export interface ActivityInput {
  activityId: string
  activityName?: string
  unit?: string
  quantityDone: number
  /** BOQ cap remaining for this activity = boqQuantity − committedToDate(excluding this report). */
  remaining: number
  manpower: ManpowerInput[]
  materials: MaterialInput[]
}

// ─── BOQ cap ───────────────────────────────────────────────────────────────

/** Remaining allowance for an activity: boq − committed (never below 0). */
export function capRemaining(boqQuantity: number, committedExcludingCurrent: number): number {
  return Math.max(0, boqQuantity - committedExcludingCurrent)
}

/** Returns an error if an activity's quantityDone exceeds its remaining cap (or is negative). */
export function capErrorFor(a: ActivityInput): string | null {
  if (!Number.isFinite(a.quantityDone) || a.quantityDone < 0) {
    return `Quantity for ${a.activityName ? `"${a.activityName}"` : 'an activity'} must be zero or more.`
  }
  if (a.quantityDone > a.remaining + EPS) {
    const label = a.activityName ? `"${a.activityName}"` : 'this activity'
    const unit = a.unit ? ` ${a.unit}` : ''
    return `Quantity for ${label} exceeds the remaining ${a.remaining}${unit}. Reduce the quantity to stay within the BOQ.`
  }
  return null
}

/** First cap violation across activities, or null. Enforced on BOTH draft save and submit. */
export function validateCaps(activities: ActivityInput[]): string | null {
  for (const a of activities) {
    const e = capErrorFor(a)
    if (e) return e
  }
  return null
}

// ─── Submit validation ────────────────────────────────────────────────────────

/**
 * Validation applied when SUBMITTING (replaces the old "≥1 work item"):
 *   - ≥1 activity with quantityDone > 0;
 *   - every manpower row: headcount ≥ 1 and hours > 0;
 *   - every material row: quantity > 0;
 *   - every activity within its remaining cap.
 * Manpower and materials remain optional per activity.
 */
export function validateForSubmit(activities: ActivityInput[]): string | null {
  const worked = activities.filter((a) => Number.isFinite(a.quantityDone) && a.quantityDone > 0)
  if (worked.length === 0) {
    return 'Add at least one activity with a quantity greater than 0 before submitting.'
  }
  for (const a of activities) {
    for (const m of a.manpower) {
      if (!Number.isFinite(m.headcount) || m.headcount < 1) {
        return 'Every manpower row needs a headcount of at least 1.'
      }
      if (!Number.isFinite(m.hours) || m.hours <= 0) {
        return 'Every manpower row needs hours greater than 0.'
      }
    }
    for (const m of a.materials) {
      if (!Number.isFinite(m.quantity) || m.quantity <= 0) {
        return 'Every material row needs a quantity greater than 0.'
      }
    }
  }
  return validateCaps(activities)
}

// ─── Cumulative % ──────────────────────────────────────────────────────────

/** Display/EVM cumulative %: min(100, earned/boq × 100). Capped at 100. */
export function cumulativePercent(earned: number, boqQuantity: number): number {
  if (!(boqQuantity > 0)) return 0
  return Math.min(100, (earned / boqQuantity) * 100)
}

// ─── Totals ──────────────────────────────────────────────────────────────────

export interface ManpowerTotals {
  workers: number
  manHours: number
}

/** Total workers = Σ headcount; total man-hours = Σ (headcount × hours). Computed, never stored. */
export function computeManpowerTotals(
  manpower: { headcount: number; hours: number }[],
): ManpowerTotals {
  return manpower.reduce<ManpowerTotals>(
    (acc, m) => ({
      workers: acc.workers + (Number.isFinite(m.headcount) ? m.headcount : 0),
      manHours:
        acc.manHours +
        (Number.isFinite(m.headcount) && Number.isFinite(m.hours) ? m.headcount * m.hours : 0),
    }),
    { workers: 0, manHours: 0 },
  )
}

/** Report totals = manpower summed across all activities. */
export function computeReportTotals(
  activities: { manpower: { headcount: number; hours: number }[] }[],
): ManpowerTotals {
  return computeManpowerTotals(activities.flatMap((a) => a.manpower))
}
