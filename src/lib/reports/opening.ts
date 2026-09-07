/**
 * Opening-balance report helpers (pure, UI-free).
 *
 * An opening report is a NORMAL DailyReport carrying `isOpeningBalance`, dated at the project start
 * date, that seeds the work done before go-live. Progress is stored per sub-activity like any report;
 * the only shortcut is a UI convenience — "this activity is 100% complete" — which expands to uniform
 * per-sub-activity rows here, so the STORED data is never activity-level.
 */

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
 * The guard message when a project cannot receive an opening report because it has no start date to
 * date it at. Null start date is the only hard blocker; returns null when the date is present.
 */
export function openingReportDateError(startDate: Date | null): string | null {
  return startDate == null
    ? 'Set the project start date before creating an opening-balance report — the report must be dated at go-live.'
    : null
}
