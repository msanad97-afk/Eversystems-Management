import { round } from '@/lib/budget'

/**
 * Phase 6C — Earned Value Management, pure and UI-free.
 *
 * House convention (money.ts / budget.ts / cost.server.ts): Decimal at the DB boundary,
 * plain numbers for arithmetic, rounded to MONEY_DP. This file is not an exception.
 *
 * Every ratio guards divide-by-zero and returns `null` (rendered "N/A") — no Infinity/NaN
 * ever reaches the UI.
 *
 * Scope note (6C.5): AC here is DIRECT scope only. Project expenses carry no budgeted value
 * and no earnable progress, so folding them into AC would drag CPI below 1.0 for reasons
 * unrelated to field productivity. They surface separately in projected margin.
 */

export const MONEY_DP = 3
const PCT_DP = 4

// ─── Percent complete, bottom-up (never typed by a manager) ───────────────────

/** MEASURED sub: Σ approved increments ÷ the parent activity's BOQ, capped at 1. */
export function measuredPercent(approvedQty: number, plannedQty: number): number {
  if (!(plannedQty > 0)) return 0
  return round(Math.min(approvedQty / plannedQty, 1), PCT_DP)
}

/**
 * LUMPSUM sub: the LATEST approved cumulative percentComplete (0–100), normalised to 0–1.
 * Not summed — each report states the running total, not an increment.
 */
export function lumpsumPercent(latestApprovedPercent: number | null): number {
  if (latestApprovedPercent == null) return 0
  return round(Math.min(Math.max(latestApprovedPercent, 0) / 100, 1), PCT_DP)
}

/** EV_i = BV_i × pct_i. */
export function earnedValue(bv: number, pct: number): number {
  return round(bv * pct, MONEY_DP)
}

// ─── Point metrics ────────────────────────────────────────────────────────────

export interface EvmInput {
  bac: number
  pv: number | null // null when the project has no baseline
  ev: number
  ac: number
}
export interface EvmMetrics {
  bac: number
  pv: number | null
  ev: number
  ac: number
  sv: number | null
  cv: number
  spi: number | null
  cpi: number | null
  eac: number
  eacIndependent: number
  etc: number
  vac: number
  pctComplete: number
}

export function computeEvm({ bac, pv, ev, ac }: EvmInput): EvmMetrics {
  const spi = pv != null && pv > 0 ? round(ev / pv, PCT_DP) : null
  const cpi = ac > 0 ? round(ev / ac, PCT_DP) : null

  // Primary EAC assumes current cost performance continues; the independent variant assumes
  // the remaining work runs to budget. Both are shown so the manager can compare.
  const eacIndependent = round(ac + (bac - ev), MONEY_DP)
  const eac = cpi != null && cpi > 0 ? round(ac + (bac - ev) / cpi, MONEY_DP) : eacIndependent

  return {
    bac: round(bac, MONEY_DP),
    pv: pv == null ? null : round(pv, MONEY_DP),
    ev: round(ev, MONEY_DP),
    ac: round(ac, MONEY_DP),
    sv: pv == null ? null : round(ev - pv, MONEY_DP),
    cv: round(ev - ac, MONEY_DP),
    spi,
    cpi,
    eac,
    eacIndependent,
    etc: round(eac - ac, MONEY_DP),
    vac: round(bac - eac, MONEY_DP),
    pctComplete: bac > 0 ? round((ev / bac) * 100, 1) : 0,
  }
}

/**
 * Cost-only metrics for a node BELOW project level (asset / activity). PV lives at project
 * level only — there is no per-asset plan — so SPI/SV are deliberately absent rather than
 * synthesised from an allocated curve, which would be as misleading as folding overhead
 * into CPI (6C.5/6C.6).
 */
export type EvmCostMetrics = Omit<EvmMetrics, 'pv' | 'sv' | 'spi'>

export function computeEvmCostOnly(input: { bac: number; ev: number; ac: number }): EvmCostMetrics {
  const full = computeEvm({ ...input, pv: null })
  const { bac, ev, ac, cv, cpi, eac, eacIndependent, etc, vac, pctComplete } = full
  return { bac, ev, ac, cv, cpi, eac, eacIndependent, etc, vac, pctComplete }
}

// ─── Baseline curve ───────────────────────────────────────────────────────────

export interface BaselinePoint {
  periodMonth: string // YYYY-MM-01
  cumPlannedPct: number // cumulative % of BAC by MONTH-END, 0–100
}

/** UTC month-end for a YYYY-MM-01 string. */
export function monthEnd(periodMonth: string): Date {
  const d = new Date(`${periodMonth}T00:00:00.000Z`)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
}
function monthStart(periodMonth: string): Date {
  return new Date(`${periodMonth}T00:00:00.000Z`)
}
const DAY = 86_400_000

/**
 * Cumulative planned % at an arbitrary date — linear on cumulative percent by calendar day
 * between month-ends. Before the first month-end it ramps from 0 at the start of that first
 * month; after the last it clamps to the final value. Returns null with no baseline.
 */
export function interpolateCumPct(points: BaselinePoint[], asOf: Date): number | null {
  if (points.length === 0) return null
  const sorted = [...points].sort((a, b) => a.periodMonth.localeCompare(b.periodMonth))
  const anchors = sorted.map((p) => ({ at: monthEnd(p.periodMonth).getTime(), pct: p.cumPlannedPct }))
  const t = asOf.getTime()

  const first = anchors[0]!
  if (t >= anchors[anchors.length - 1]!.at) return round(anchors[anchors.length - 1]!.pct, PCT_DP)
  if (t <= first.at) {
    // Ramp from 0% at the start of the first baseline month.
    const start = monthStart(sorted[0]!.periodMonth).getTime() - DAY
    if (t <= start) return 0
    const frac = (t - start) / (first.at - start)
    return round(first.pct * frac, PCT_DP)
  }
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i]!
    const b = anchors[i + 1]!
    if (t >= a.at && t <= b.at) {
      const frac = b.at === a.at ? 1 : (t - a.at) / (b.at - a.at)
      return round(a.pct + (b.pct - a.pct) * frac, PCT_DP)
    }
  }
  return round(anchors[anchors.length - 1]!.pct, PCT_DP)
}

/** PV(asOf) = cumPct(asOf)/100 × BAC. Null (→ "no baseline") when the curve is empty. */
export function plannedValue(points: BaselinePoint[], asOf: Date, bac: number): number | null {
  const pct = interpolateCumPct(points, asOf)
  return pct == null ? null : round((pct / 100) * bac, MONEY_DP)
}

export interface BaselineError {
  index: number | null
  message: string
}

/**
 * The four server-enforced rules (6C.3). An EMPTY curve is valid — it clears the baseline
 * and PV becomes null. Otherwise: first-of-month, contiguous, non-decreasing, ends at 100.
 */
export function validateBaseline(points: BaselinePoint[]): BaselineError[] {
  const errors: BaselineError[] = []
  if (points.length === 0) return errors

  const sorted = [...points].sort((a, b) => a.periodMonth.localeCompare(b.periodMonth))

  sorted.forEach((p, i) => {
    if (!/^\d{4}-\d{2}-01$/.test(p.periodMonth)) errors.push({ index: i, message: `"${p.periodMonth}" must be the first day of a month (YYYY-MM-01).` })
    if (!Number.isFinite(p.cumPlannedPct) || p.cumPlannedPct < 0 || p.cumPlannedPct > 100) {
      errors.push({ index: i, message: `Cumulative percent must be between 0 and 100 (got ${p.cumPlannedPct}).` })
    }
  })
  if (errors.length > 0) return errors

  for (let i = 1; i < sorted.length; i++) {
    const prev = monthStart(sorted[i - 1]!.periodMonth)
    const cur = monthStart(sorted[i]!.periodMonth)
    const expected = new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth() + 1, 1))
    if (cur.getTime() !== expected.getTime()) {
      errors.push({ index: i, message: `Months must be contiguous — expected ${expected.toISOString().slice(0, 10)} after ${sorted[i - 1]!.periodMonth}.` })
    }
    if (sorted[i]!.cumPlannedPct < sorted[i - 1]!.cumPlannedPct) {
      errors.push({ index: i, message: `Cumulative percent cannot go down (${sorted[i - 1]!.cumPlannedPct}% → ${sorted[i]!.cumPlannedPct}%).` })
    }
  }
  const last = sorted[sorted.length - 1]!
  if (last.cumPlannedPct !== 100) {
    errors.push({ index: sorted.length - 1, message: `The final month must reach 100% (got ${last.cumPlannedPct}%).` })
  }
  return errors
}

// ─── Month helpers for the historical series ──────────────────────────────────

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

/** Inclusive list of YYYY-MM-01 keys from `from` to `to`. */
export function monthRange(from: Date, to: Date): string[] {
  const out: string[] = []
  const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1))
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1))
  // Guard against a runaway range (bad dates) — 600 months is far past any real project.
  let guard = 0
  while (cur.getTime() <= end.getTime() && guard++ < 600) {
    out.push(monthKey(cur))
    cur.setUTCMonth(cur.getUTCMonth() + 1)
  }
  return out
}
