import { describe, it, expect } from 'vitest'
import {
  directionFor, accountBalances, sumBalances, paymentState, ageBucket, forecastInflows,
  type BalanceTxn,
} from '@/lib/cash'

describe('direction is derived from category', () => {
  it('inflow categories', () => {
    for (const c of ['VALUATION_RECEIPT', 'ADVANCE_PAYMENT', 'RETENTION_RELEASE', 'OTHER_IN'] as const) {
      expect(directionFor(c)).toBe('IN')
    }
  })
  it('outflow categories, including LOAN_FINANCE (repayment)', () => {
    for (const c of ['SUPPLIER_PAYMENT', 'SUBCONTRACTOR_PAYMENT', 'PAYROLL', 'EQUIPMENT', 'OVERHEAD', 'VAT_TAX', 'LOAN_FINANCE', 'OTHER_OUT'] as const) {
      expect(directionFor(c)).toBe('OUT')
    }
  })
})

describe('account balances', () => {
  const txns: BalanceTxn[] = [
    { direction: 'IN', amount: 1000, cleared: true },
    { direction: 'OUT', amount: 300, cleared: true },
    { direction: 'IN', amount: 500, cleared: false }, // pending
    { direction: 'OUT', amount: 200, cleared: false }, // pending
  ]
  it('clearedBalance = opening + Σ cleared only', () => {
    const b = accountBalances(2000, txns)
    expect(b.clearedBalance).toBe(2700) // 2000 + 1000 − 300
  })
  it('projectedBalance includes pending', () => {
    const b = accountBalances(2000, txns)
    expect(b.pendingIn).toBe(500)
    expect(b.pendingOut).toBe(200)
    expect(b.projectedBalance).toBe(3000) // 2700 + 500 − 200
  })
  it('company totals sum element-wise', () => {
    const a = accountBalances(2000, txns)
    const b = accountBalances(0, [{ direction: 'IN', amount: 100, cleared: true }])
    const t = sumBalances([a, b])
    expect(t.clearedBalance).toBe(2800)
    expect(t.projectedBalance).toBe(3100)
  })
})

describe('payment state — derived, never typed', () => {
  it('UNINVOICED → INVOICED (manual) → PART_PAID → PAID', () => {
    expect(paymentState(1000, 0, null)).toBe('UNINVOICED')
    expect(paymentState(1000, 0, new Date())).toBe('INVOICED')
    expect(paymentState(1000, 400, new Date())).toBe('PART_PAID')
    expect(paymentState(1000, 1000, new Date())).toBe('PAID')
  })
  it('PAID flips as soon as receipts ≥ netPayable, invoiced or not', () => {
    expect(paymentState(1000, 1000, null)).toBe('PAID')
  })
  it('OVERPAID is distinct — never a bare negative', () => {
    expect(paymentState(1000, 1200, new Date())).toBe('OVERPAID')
  })
})

describe('ageing buckets — correct at the 30/60/90 boundaries', () => {
  const today = new Date('2026-04-30T00:00:00.000Z')
  const daysBefore = (n: number) => new Date(Date.UTC(2026, 3, 30 - n))

  it('null due date → its own bucket, never current', () => {
    expect(ageBucket(null, today)).toBe('NO_DUE_DATE')
  })
  it('future / today → not yet due', () => {
    expect(ageBucket(new Date('2026-05-10T00:00:00.000Z'), today)).toBe('NOT_YET_DUE')
    expect(ageBucket(today, today)).toBe('NOT_YET_DUE')
  })
  it('1 and 30 days overdue → 1–30', () => {
    expect(ageBucket(daysBefore(1), today)).toBe('DUE_1_30')
    expect(ageBucket(daysBefore(30), today)).toBe('DUE_1_30')
  })
  it('31 and 60 → 31–60; 61 and 90 → 61–90; 91 → 90+', () => {
    expect(ageBucket(daysBefore(31), today)).toBe('DUE_31_60')
    expect(ageBucket(daysBefore(60), today)).toBe('DUE_31_60')
    expect(ageBucket(daysBefore(61), today)).toBe('DUE_61_90')
    expect(ageBucket(daysBefore(90), today)).toBe('DUE_61_90')
    expect(ageBucket(daysBefore(91), today)).toBe('DUE_90_PLUS')
  })
})

describe('forecast — inflows only, overdue lands in the current month', () => {
  const from = '2026-04-01'
  it('buckets each outstanding by its expected-receipt month', () => {
    const rows = forecastInflows([
      { expectedReceipt: new Date('2026-04-15T00:00:00.000Z'), outstanding: 1000 },
      { expectedReceipt: new Date('2026-05-20T00:00:00.000Z'), outstanding: 500 },
    ], from, 3)
    expect(rows).toEqual([
      { month: '2026-04-01', projectedInflow: 1000 },
      { month: '2026-05-01', projectedInflow: 500 },
      { month: '2026-06-01', projectedInflow: 0 },
    ])
  })
  it('an overdue amount (before the window) is expected NOW — first bucket', () => {
    const rows = forecastInflows([{ expectedReceipt: new Date('2026-01-10T00:00:00.000Z'), outstanding: 800 }], from, 2)
    expect(rows[0]).toEqual({ month: '2026-04-01', projectedInflow: 800 })
  })
  it('a null due date is also expected now', () => {
    const rows = forecastInflows([{ expectedReceipt: null, outstanding: 300 }], from, 2)
    expect(rows[0]!.projectedInflow).toBe(300)
  })
  it('non-positive outstanding contributes nothing', () => {
    const rows = forecastInflows([{ expectedReceipt: null, outstanding: 0 }, { expectedReceipt: null, outstanding: -5 }], from, 1)
    expect(rows[0]!.projectedInflow).toBe(0)
  })
  it('amounts beyond the horizon are dropped', () => {
    const rows = forecastInflows([{ expectedReceipt: new Date('2027-01-01T00:00:00.000Z'), outstanding: 900 }], from, 3)
    expect(rows.every((r) => r.projectedInflow === 0)).toBe(true)
  })
})
