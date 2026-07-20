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

// ─── Report content (sub-activity-structured, Phase C2) ────────────────────────

export interface ManpowerInput {
  categoryId: string
  headcount: number
  hours: number
}
export interface MaterialInput {
  materialId: string
  quantity: number
}
/**
 * One reportable line = one sub-activity (implicit when the activity has no named ones).
 * MEASURED lines carry quantityDone (increment, capped); LUMPSUM lines carry
 * percentComplete (cumulative 0–100, may not regress below the last approved %).
 */
export interface SubActivityInput {
  subActivityId: string
  label?: string
  type: 'MEASURED' | 'LUMPSUM'
  unit?: string
  // measured
  quantityDone: number
  /** cap remaining = boqQuantity − committedToDate(excluding this report). */
  remaining: number
  // lumpsum
  percentComplete: number
  lastApprovedPercent: number
  manpower: ManpowerInput[]
  materials: MaterialInput[]
}

// ─── Caps & bounds ─────────────────────────────────────────────────────────

/** Remaining allowance for a measured sub-activity: boq − committed (never below 0). */
export function capRemaining(boqQuantity: number, committedExcludingCurrent: number): number {
  return Math.max(0, boqQuantity - committedExcludingCurrent)
}

/** Validation error for one line (measured cap / lumpsum bounds), or null. */
export function subActivityError(s: SubActivityInput): string | null {
  const label = s.label ? `"${s.label}"` : 'a line'
  if (s.type === 'LUMPSUM') {
    if (!Number.isFinite(s.percentComplete) || s.percentComplete < 0 || s.percentComplete > 100) {
      return `Percent complete for ${label} must be between 0 and 100.`
    }
    if (s.percentComplete < s.lastApprovedPercent - EPS) {
      return `Percent complete for ${label} can't drop below the last approved ${s.lastApprovedPercent}%.`
    }
    return null
  }
  if (!Number.isFinite(s.quantityDone) || s.quantityDone < 0) {
    return `Quantity for ${label} must be zero or more.`
  }
  if (s.quantityDone > s.remaining + EPS) {
    const unit = s.unit ? ` ${s.unit}` : ''
    return `Quantity for ${label} exceeds the remaining ${s.remaining}${unit}. Reduce it to stay within the BOQ.`
  }
  return null
}

/** First line violation across all lines, or null. Enforced on BOTH draft save and submit. */
export function validateSubActivities(subs: SubActivityInput[]): string | null {
  for (const s of subs) {
    const e = subActivityError(s)
    if (e) return e
  }
  return null
}

/** Whether a line records real progress today (measured qty > 0, or lumpsum % > 0). */
export function hasProgress(s: Pick<SubActivityInput, 'type' | 'quantityDone' | 'percentComplete'>): boolean {
  return s.type === 'LUMPSUM' ? Number(s.percentComplete) > 0 : Number(s.quantityDone) > 0
}

// ─── Submit validation ────────────────────────────────────────────────────────

/**
 * Applied when SUBMITTING:
 *   - ≥1 line with progress (a quantity, or a % complete);
 *   - every manpower row: headcount ≥ 1 and hours > 0;
 *   - every material row: quantity > 0;
 *   - every line within its cap / lumpsum bounds.
 * Manpower and materials remain optional per line.
 */
export function validateForSubmit(subs: SubActivityInput[]): string | null {
  if (!subs.some(hasProgress)) {
    return 'Add at least one line with progress (a quantity or a % complete) before submitting.'
  }
  for (const s of subs) {
    for (const m of s.manpower) {
      if (!Number.isFinite(m.headcount) || m.headcount < 1) return 'Every manpower row needs a headcount of at least 1.'
      if (!Number.isFinite(m.hours) || m.hours <= 0) return 'Every manpower row needs hours greater than 0.'
    }
    for (const m of s.materials) {
      if (!Number.isFinite(m.quantity) || m.quantity <= 0) return 'Every material row needs a quantity greater than 0.'
    }
  }
  return validateSubActivities(subs)
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
