/**
 * Opening-balance report helpers (pure, UI-free).
 *
 * An opening report is a NORMAL DailyReport carrying `isOpeningBalance` that seeds the work done
 * before go-live. It is dated to sit immediately BEHIND the recorded history — the day before the
 * project's earliest report — so a period chart shows no gap. Progress is stored per sub-activity
 * like any report; the only shortcut is a UI convenience — "this activity is 100% complete" — which
 * expands to uniform per-sub-activity rows here, so the STORED data is never activity-level.
 */

import { addDays } from '@/lib/datetime'

const iso = (d: Date) => d.toISOString().slice(0, 10)

export interface OpeningSub {
  subActivityId: string
  type: 'MEASURED' | 'LUMPSUM'
  boqQuantity: number
}
export interface OpeningSubEntry {
  subActivityId: string
  quantityDone: number
  percentComplete: number
}

/**
 * Expand the activity-level "100% complete" shortcut to per-sub-activity rows: a measured sub is
 * filled to its BOQ (cumulativePercent(boq, boq) = 100), a lumpsum sub to 100%. Anything below 100%
 * is entered per sub-activity instead — never through this shortcut.
 */
export function expandActivityHundred(subs: OpeningSub[]): OpeningSubEntry[] {
  return subs.map((s) =>
    s.type === 'LUMPSUM'
      ? { subActivityId: s.subActivityId, quantityDone: 0, percentComplete: 100 }
      : { subActivityId: s.subActivityId, quantityDone: s.boqQuantity, percentComplete: 0 },
  )
}

/**
 * The guard message when a project cannot receive an opening report because it has no start date —
 * the start date is the lower bound for the opening date, so it must be set first. Returns null when
 * the date is present.
 */
export function openingReportDateError(startDate: Date | null): string | null {
  return startDate == null
    ? 'Set the project start date before creating an opening-balance report — it is the earliest the report can be dated.'
    : null
}

/**
 * The default opening-report date: the day BEFORE the project's earliest existing report, so the
 * opening balance sits immediately behind the recorded history with no gap. With no reports yet, fall
 * back to the project start date. (Both @db.Date values are UTC-midnight civil dates.)
 */
export function defaultOpeningDate(startDate: Date, earliestReportDate: Date | null): Date {
  return earliestReportDate ? addDays(earliestReportDate, -1) : startDate
}

/**
 * Validate an admin-SUPPLIED opening date against its two bounds (a computed default is trusted and
 * not run through this). It must be on or after the project start date (it cannot predate the project)
 * and strictly before the earliest recorded report (opening work must precede recorded history, or the
 * as-of figures break). Returns an error message, or null when the date is acceptable.
 */
export function validateOpeningDate(date: Date, startDate: Date, earliestReportDate: Date | null): string | null {
  if (date.getTime() < startDate.getTime()) {
    return `The opening balance cannot be dated before the project start date (${iso(startDate)}).`
  }
  if (earliestReportDate && date.getTime() >= earliestReportDate.getTime()) {
    return `The opening balance must be dated before the first recorded report (${iso(earliestReportDate)}) — opening work has to precede recorded history, or the as-of figures break.`
  }
  return null
}
