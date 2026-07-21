import { round } from '@/lib/budget'
import { MONEY_DP } from '@/lib/evm'

/**
 * Phase 6D — interim payment certificates (IPCs), pure and UI-free.
 *
 * House convention (money.ts / evm.ts): Decimal at the DB boundary, plain numbers for
 * arithmetic, rounded to MONEY_DP; every ratio guards divide-by-zero.
 *
 * THE BILLING MODEL — two streams, combined per asset:
 *
 *   MEASURED. A measured activity can carry several PARALLEL STAGE sub-activities (EPS
 *   fixing / basecoat / painting) that each report against the SAME parent BOQ — they are
 *   not partitions of the quantity. So certified value is the activity's contract value
 *   times its BV-weighted percent complete (the exact fraction 6C computes for cost), never
 *   a sum of sub-quantities, which would over-bill a multi-stage activity several-fold:
 *
 *       certifiedMeasured = billRate × boqQuantity × (Σ EV_sub ÷ Σ BV_sub)
 *
 *   Each sub is already capped at 100% by 6C's `measuredPercent`, so an activity can never
 *   certify above its contract value. For a single/implicit-sub activity this reduces
 *   exactly to min(approvedQty, BOQ) × billRate.
 *
 *   LUMPSUM. A lump-sum activity is a cost with no rate and no quantity, so it cannot bill
 *   bottom-up. The asset carries `lumpsumRevenue`, recovered by the asset's aggregate
 *   lump-sum cost-progress fraction — again Σ EV ÷ Σ BV, from the same 6C path.
 *
 * NAMING: everything on this side is *revenue* (`certified…`). It is never the earned COST
 * that `actuals.server.ts` calls `lumpsumEarnedBhd`. The two are only equal at zero margin.
 */

const PCT_DP = 4

// ─── Inputs ──────────────────────────────────────────────────────────────────

export interface ValuationActivityInput {
  activityId: string
  type: 'MEASURED' | 'LUMPSUM'
  billRate: number | null
  boqQuantity: number
  /** Σ EV and Σ BV over this activity's MEASURED sub-activities, as of the period end. */
  measuredEv: number
  measuredBv: number
}

export interface ValuationAssetInput {
  assetId: string
  assetName: string
  sortOrder: number
  lumpsumRevenue: number | null
  /** Σ EV and Σ BV over this asset's LUMPSUM sub-activities, as of the period end. */
  lumpsumEv: number
  lumpsumBv: number
  activities: ValuationActivityInput[]
}

// ─── Outputs ─────────────────────────────────────────────────────────────────

export interface ValuationLineFigures {
  assetId: string
  assetName: string
  sortOrder: number
  cumulativeMeasured: number
  cumulativeLumpsum: number
  cumulativeGross: number
}

export interface ValuationCumulative {
  lines: ValuationLineFigures[]
  cumulativeMeasured: number
  cumulativeLumpsum: number
  cumulativeGross: number
}

export interface PeriodInput {
  cumulativeGross: number
  /** Prior period's certified cumulative gross; 0 when this is the first certificate. */
  previousGross: number
  /** Contract value the certificate bills against (frozen at certify, live while drafting). */
  contractValue: number
  retentionPct: number | null
  retentionCapPct: number | null
  /** Cumulative retention held on the prior period's certified revision; 0 if none. */
  previousRetentionHeld: number
  advancePct: number | null
  /** Σ advance recovered on the certified revision of every earlier period. */
  advanceRecoveredToDate: number
}

export interface PeriodFigures {
  grossThisPeriod: number
  /** Cumulative retention held to date (what the header stores). */
  retentionHeld: number
  retentionThisPeriod: number
  advanceRecovery: number
  netThisPeriod: number
  progressPct: number
}

// ─── Derivation ──────────────────────────────────────────────────────────────

/**
 * The 6C progress fraction, 0–1. Σ BV = 0 means nothing budgeted here (unpriced scope, or no
 * sub-activities of this kind) — there is no denominator, so nothing is certified.
 */
export function progressFraction(ev: number, bv: number): number {
  if (!(bv > 0)) return 0
  return round(Math.min(Math.max(ev / bv, 0), 1), PCT_DP)
}

/** Certified revenue for one measured activity. A missing billRate certifies at zero. */
export function certifiedMeasured(a: ValuationActivityInput): number {
  if (a.type !== 'MEASURED' || a.billRate == null) return 0
  return round(a.billRate * a.boqQuantity * progressFraction(a.measuredEv, a.measuredBv), MONEY_DP)
}

/** Certified revenue for one asset's lump-sum scope. A null lumpsumRevenue certifies at zero. */
export function certifiedLumpsum(asset: ValuationAssetInput): number {
  if (asset.lumpsumRevenue == null) return 0
  return round(progressFraction(asset.lumpsumEv, asset.lumpsumBv) * asset.lumpsumRevenue, MONEY_DP)
}

export function deriveAssetValuation(asset: ValuationAssetInput): ValuationLineFigures {
  const cumulativeMeasured = round(asset.activities.reduce((s, a) => s + certifiedMeasured(a), 0), MONEY_DP)
  const cumulativeLumpsum = certifiedLumpsum(asset)
  return {
    assetId: asset.assetId,
    assetName: asset.assetName,
    sortOrder: asset.sortOrder,
    cumulativeMeasured,
    cumulativeLumpsum,
    cumulativeGross: round(cumulativeMeasured + cumulativeLumpsum, MONEY_DP),
  }
}

export function deriveValuationCumulative(assets: ValuationAssetInput[]): ValuationCumulative {
  const lines = assets.map(deriveAssetValuation)
  const cumulativeMeasured = round(lines.reduce((s, l) => s + l.cumulativeMeasured, 0), MONEY_DP)
  const cumulativeLumpsum = round(lines.reduce((s, l) => s + l.cumulativeLumpsum, 0), MONEY_DP)
  return {
    lines,
    cumulativeMeasured,
    cumulativeLumpsum,
    cumulativeGross: round(cumulativeMeasured + cumulativeLumpsum, MONEY_DP),
  }
}

/**
 * Period arithmetic: cumulative minus previous, then retention and advance recovery.
 *
 * `grossThisPeriod` is deliberately NOT clamped — a downward re-measure between certificates
 * is a legitimate negative certificate, and hiding it would overstate what has been billed.
 *
 * Retention is a percent of CUMULATIVE gross (standard Gulf BOQ), optionally capped once held
 * retention reaches `retentionCapPct` of contract value. Advance recovery is pro-rata of this
 * period's gross and stops at the outstanding balance, so the advance is never over-recovered;
 * on a negative period it un-recovers, but never more than has actually been recovered.
 */
export function computePeriod(input: PeriodInput): PeriodFigures {
  const {
    cumulativeGross, previousGross, contractValue,
    retentionPct, retentionCapPct, previousRetentionHeld,
    advancePct, advanceRecoveredToDate,
  } = input

  const grossThisPeriod = round(cumulativeGross - previousGross, MONEY_DP)

  // ── retention (null pct = the contract has none) ──
  const retRate = (retentionPct ?? 0) / 100
  let retentionHeld = round(retRate * cumulativeGross, MONEY_DP)
  if (retentionCapPct != null) {
    retentionHeld = Math.min(retentionHeld, round((retentionCapPct / 100) * contractValue, MONEY_DP))
  }
  const retentionThisPeriod = round(retentionHeld - previousRetentionHeld, MONEY_DP)

  // ── advance recovery ──
  const advRate = (advancePct ?? 0) / 100
  const totalAdvance = round(advRate * contractValue, MONEY_DP)
  const outstanding = Math.max(0, round(totalAdvance - advanceRecoveredToDate, MONEY_DP))
  const rawRecovery = round(advRate * grossThisPeriod, MONEY_DP)
  const advanceRecovery = round(
    Math.min(Math.max(rawRecovery, -advanceRecoveredToDate), outstanding),
    MONEY_DP,
  )

  return {
    grossThisPeriod,
    retentionHeld,
    retentionThisPeriod,
    advanceRecovery,
    netThisPeriod: round(grossThisPeriod - retentionThisPeriod - advanceRecovery, MONEY_DP),
    progressPct: contractValue > 0 ? round((cumulativeGross / contractValue) * 100, 3) : 0,
  }
}

// ─── Period helpers ──────────────────────────────────────────────────────────

/** UTC first-of-month for a YYYY-MM-01 string. Valuation periods are always whole months. */
export function periodStart(periodMonth: string): Date {
  return new Date(`${periodMonth}T00:00:00.000Z`)
}

/** The as-of cutoff for a period: the last day of that month, UTC. */
export function periodEnd(periodMonth: string): Date {
  const d = periodStart(periodMonth)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
}

export function isPeriodMonth(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-01$/.test(value) && !Number.isNaN(periodStart(value).getTime())
}

/** The certificate code for a revision: base at rev 0, then "-r1", "-r2" … */
export function revisionCode(baseCode: string, revisionNumber: number): string {
  return revisionNumber === 0 ? baseCode : `${baseCode}-r${revisionNumber}`
}

/** Strip any "-rN" suffix to recover the month's base code. */
export function baseCode(valuationCode: string): string {
  return valuationCode.replace(/-r\d+$/, '')
}

/** Expected receipt = certification date + the project's payment terms. Null terms → null. */
export function expectedReceiptDate(certifiedAt: Date, paymentTermsDays: number | null): Date | null {
  if (paymentTermsDays == null) return null
  const d = new Date(Date.UTC(certifiedAt.getUTCFullYear(), certifiedAt.getUTCMonth(), certifiedAt.getUTCDate()))
  d.setUTCDate(d.getUTCDate() + paymentTermsDays)
  return d
}
