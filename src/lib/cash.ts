import type { CashCategory, CashDirection } from '@prisma/client'
import { round } from '@/lib/budget'
import { MONEY_DP } from '@/lib/evm'

/**
 * Phase 6E — Cash, pure and UI-free. House convention (evm.ts / valuation.ts): Decimal at the
 * DB boundary, plain numbers for arithmetic rounded to MONEY_DP, ratios guard divide-by-zero.
 *
 * The forecast is derived, never stored, and is INFLOW-ONLY: expenses are accrued costs with
 * no due date, so a projected outflow would be invented. There is deliberately no outflow
 * field anywhere in this file — the UI states outflows are not forecast rather than showing 0.
 */

// ─── Direction is derived from category (never trusted from the client) ───────

/**
 * Every category has exactly one valid direction, so the OUT+VALUATION_RECEIPT contradiction
 * class cannot occur. LOAN_FINANCE is OUT (repayments are the common case); a drawdown is
 * recorded as OTHER_IN — the UI notes this so it is not a surprise.
 */
const OUT_CATEGORIES: ReadonlySet<CashCategory> = new Set<CashCategory>([
  'SUPPLIER_PAYMENT', 'SUBCONTRACTOR_PAYMENT', 'PAYROLL', 'EQUIPMENT', 'OVERHEAD',
  'VAT_TAX', 'LOAN_FINANCE', 'OTHER_OUT',
])

export function directionFor(category: CashCategory): CashDirection {
  return OUT_CATEGORIES.has(category) ? 'OUT' : 'IN'
}

// ─── Balances ─────────────────────────────────────────────────────────────────

export interface BalanceTxn {
  direction: CashDirection
  amount: number
  cleared: boolean // clearedAt != null
}

export interface AccountBalances {
  clearedBalance: number // matches the bank statement: opening + Σ cleared IN − Σ cleared OUT
  pendingIn: number // entered, not yet cleared
  pendingOut: number
  projectedBalance: number // clearedBalance + pendingIn − pendingOut
}

/** Cleared and projected balances for one account from its opening balance + transactions. */
export function accountBalances(openingBalance: number, txns: BalanceTxn[]): AccountBalances {
  let clearedIn = 0, clearedOut = 0, pendingIn = 0, pendingOut = 0
  for (const t of txns) {
    if (t.cleared) {
      if (t.direction === 'IN') clearedIn += t.amount
      else clearedOut += t.amount
    } else {
      if (t.direction === 'IN') pendingIn += t.amount
      else pendingOut += t.amount
    }
  }
  const clearedBalance = round(openingBalance + clearedIn - clearedOut, MONEY_DP)
  const pIn = round(pendingIn, MONEY_DP)
  const pOut = round(pendingOut, MONEY_DP)
  return {
    clearedBalance,
    pendingIn: pIn,
    pendingOut: pOut,
    projectedBalance: round(clearedBalance + pIn - pOut, MONEY_DP),
  }
}

/** Company totals = element-wise sum of per-account balances. */
export function sumBalances(list: AccountBalances[]): AccountBalances {
  return list.reduce<AccountBalances>(
    (acc, b) => ({
      clearedBalance: round(acc.clearedBalance + b.clearedBalance, MONEY_DP),
      pendingIn: round(acc.pendingIn + b.pendingIn, MONEY_DP),
      pendingOut: round(acc.pendingOut + b.pendingOut, MONEY_DP),
      projectedBalance: round(acc.projectedBalance + b.projectedBalance, MONEY_DP),
    }),
    { clearedBalance: 0, pendingIn: 0, pendingOut: 0, projectedBalance: 0 },
  )
}

// ─── Payment state (derived — never a Valuation.status transition) ────────────

export type PaymentState = 'UNINVOICED' | 'INVOICED' | 'PART_PAID' | 'PAID' | 'OVERPAID'

/**
 * Derived from the money, not from status. PAID flips the moment receipts ≥ netPayable;
 * OVERPAID is surfaced distinctly (with the amount) rather than as a bare negative outstanding.
 */
export function paymentState(netPayable: number, receiptsTotal: number, invoicedAt: Date | string | null): PaymentState {
  const outstanding = round(netPayable - receiptsTotal, MONEY_DP)
  if (outstanding < 0) return 'OVERPAID'
  if (outstanding === 0 && receiptsTotal > 0) return 'PAID'
  if (receiptsTotal > 0) return 'PART_PAID'
  if (invoicedAt != null) return 'INVOICED'
  return 'UNINVOICED'
}

// ─── Ageing ───────────────────────────────────────────────────────────────────

export type AgeBucket = 'NO_DUE_DATE' | 'NOT_YET_DUE' | 'DUE_1_30' | 'DUE_31_60' | 'DUE_61_90' | 'DUE_90_PLUS'

export const AGE_BUCKET_LABEL: Record<AgeBucket, string> = {
  NO_DUE_DATE: 'No due date',
  NOT_YET_DUE: 'Not yet due',
  DUE_1_30: '1–30 days overdue',
  DUE_31_60: '31–60 days overdue',
  DUE_61_90: '61–90 days overdue',
  DUE_90_PLUS: '90+ days overdue',
}

const DAY = 86_400_000
const utcMidnight = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())

/**
 * Bucket an expected-receipt date against today. A null date (no payment terms) is an explicit
 * "no due date" — never silently treated as current. Overdue days are whole days past due.
 */
export function ageBucket(expectedReceipt: Date | null, today: Date): AgeBucket {
  if (expectedReceipt == null) return 'NO_DUE_DATE'
  const overdueDays = Math.floor((utcMidnight(today) - utcMidnight(expectedReceipt)) / DAY)
  if (overdueDays <= 0) return 'NOT_YET_DUE'
  if (overdueDays <= 30) return 'DUE_1_30'
  if (overdueDays <= 60) return 'DUE_31_60'
  if (overdueDays <= 90) return 'DUE_61_90'
  return 'DUE_90_PLUS'
}

// ─── Forecast bucketing (inflows only) ────────────────────────────────────────

/** YYYY-MM-01 key for a date, UTC. */
export function monthKeyOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

export interface ForecastInflow {
  expectedReceipt: Date | null
  outstanding: number
}
export interface ForecastMonth {
  month: string // YYYY-MM-01
  projectedInflow: number
}

/** The month keys for a forecast window: `months` consecutive months from `fromMonth`. */
function windowKeys(fromMonth: string, months: number): string[] {
  const start = new Date(`${fromMonth}T00:00:00.000Z`)
  const keys: string[] = []
  for (let i = 0; i < months; i++) {
    keys.push(monthKeyOf(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1))))
  }
  return keys
}

/**
 * Bucket dated, outstanding amounts into a forecast window. A null date — or a date before the
 * window (overdue) — is expected NOW and lands in the first bucket; amounts beyond the horizon
 * are dropped. Non-positive amounts contribute nothing. Shared by the inflow and outflow sides
 * so they follow exactly the same rule.
 */
function bucketByMonth(items: { date: Date | null; amount: number }[], keys: string[]): Map<string, number> {
  const firstKey = keys[0]!
  const lastKey = keys[keys.length - 1]!
  const byMonth = new Map<string, number>(keys.map((k) => [k, 0]))
  for (const it of items) {
    if (it.amount <= 0) continue
    let key = it.date == null ? firstKey : monthKeyOf(it.date)
    if (key < firstKey) key = firstKey
    if (key > lastKey) continue
    byMonth.set(key, round((byMonth.get(key) ?? 0) + it.amount, MONEY_DP))
  }
  return byMonth
}

/**
 * Monthly projected inflow (Phase 6E, inflow-only). Kept as-is so its callers and tests are
 * unchanged; the combined Phase 7 builder below reuses the same bucketing rule.
 */
export function forecastInflows(inflows: ForecastInflow[], fromMonth: string, months: number): ForecastMonth[] {
  const keys = windowKeys(fromMonth, months)
  const byMonth = bucketByMonth(inflows.map((f) => ({ date: f.expectedReceipt, amount: f.outstanding })), keys)
  return keys.map((month) => ({ month, projectedInflow: round(byMonth.get(month) ?? 0, MONEY_DP) }))
}

// ─── Phase 7: inflow + outflow + net + running balance ─────────────────────────

export interface ForecastOutflow {
  dueDate: Date | null
  outstanding: number
}
export interface ForecastRow {
  month: string // YYYY-MM-01
  projectedInflow: number
  projectedOutflow: number
  projectedNet: number // inflow − outflow
  runningBalance: number // clearedBalance + Σ net to date
}

/**
 * The full monthly forecast: inflows from receivables, outflows from dated expense payables,
 * their net, and the running balance carried from `clearedBalance`. Outflows with a null due
 * date are NOT here — they are the caller's "unscheduled payables", reported separately so a
 * month is never silently inflated. Overdue inflows and outflows both land in the first month.
 */
export function buildForecast(
  inflows: ForecastInflow[],
  outflows: ForecastOutflow[],
  clearedBalance: number,
  fromMonth: string,
  months: number,
): ForecastRow[] {
  const keys = windowKeys(fromMonth, months)
  const inByMonth = bucketByMonth(inflows.map((f) => ({ date: f.expectedReceipt, amount: f.outstanding })), keys)
  // A null-dueDate outflow is unscheduled → excluded here (bucketByMonth would put it in month 1).
  const outByMonth = bucketByMonth(outflows.filter((o) => o.dueDate != null).map((o) => ({ date: o.dueDate, amount: o.outstanding })), keys)

  let running = round(clearedBalance, MONEY_DP)
  return keys.map((month) => {
    const projectedInflow = round(inByMonth.get(month) ?? 0, MONEY_DP)
    const projectedOutflow = round(outByMonth.get(month) ?? 0, MONEY_DP)
    const projectedNet = round(projectedInflow - projectedOutflow, MONEY_DP)
    running = round(running + projectedNet, MONEY_DP)
    return { month, projectedInflow, projectedOutflow, projectedNet, runningBalance: running }
  })
}

/** Σ outstanding of payables with NO due date — reported beside the forecast, never bucketed. */
export function unscheduledPayables(outflows: ForecastOutflow[]): number {
  return round(outflows.filter((o) => o.dueDate == null && o.outstanding > 0).reduce((s, o) => s + o.outstanding, 0), MONEY_DP)
}
