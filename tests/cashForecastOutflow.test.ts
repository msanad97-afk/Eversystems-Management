import { describe, it, expect } from 'vitest'
import { buildForecast, unscheduledPayables, forecastInflows, type ForecastInflow, type ForecastOutflow } from '@/lib/cash'

const d = (s: string) => new Date(`${s}T00:00:00.000Z`)

describe('forecastInflows (6E) is unchanged', () => {
  it('still buckets inflow-only and returns the same shape', () => {
    const rows = forecastInflows([{ expectedReceipt: d('2026-04-15'), outstanding: 1000 }], '2026-04-01', 2)
    expect(rows).toEqual([
      { month: '2026-04-01', projectedInflow: 1000 },
      { month: '2026-05-01', projectedInflow: 0 },
    ])
  })
})

describe('buildForecast — inflow, outflow, net, running balance', () => {
  const inflows: ForecastInflow[] = [
    { expectedReceipt: d('2026-04-20'), outstanding: 1000 },
    { expectedReceipt: d('2026-05-20'), outstanding: 500 },
  ]
  const outflows: ForecastOutflow[] = [
    { dueDate: d('2026-04-10'), outstanding: 400 },
    { dueDate: d('2026-06-10'), outstanding: 900 },
  ]

  it('nets inflow − outflow and carries the running balance from cleared', () => {
    const rows = buildForecast(inflows, outflows, 2000, '2026-04-01', 3)
    expect(rows).toEqual([
      { month: '2026-04-01', projectedInflow: 1000, projectedOutflow: 400, projectedNet: 600, runningBalance: 2600 },
      { month: '2026-05-01', projectedInflow: 500, projectedOutflow: 0, projectedNet: 500, runningBalance: 3100 },
      { month: '2026-06-01', projectedInflow: 0, projectedOutflow: 900, projectedNet: -900, runningBalance: 2200 },
    ])
  })

  it('a running balance that dips below zero is visible in the series', () => {
    const rows = buildForecast([], [{ dueDate: d('2026-04-10'), outstanding: 3000 }], 2000, '2026-04-01', 2)
    expect(rows[0]!.runningBalance).toBe(-1000)
    expect(rows.find((r) => r.runningBalance < 0)!.month).toBe('2026-04-01')
  })

  it('overdue outflows (before the window) land in the first month, mirroring inflows', () => {
    const rows = buildForecast([], [{ dueDate: d('2026-01-01'), outstanding: 700 }], 1000, '2026-04-01', 2)
    expect(rows[0]!.projectedOutflow).toBe(700)
  })

  it('a NULL due date is NOT bucketed — it never appears in any month', () => {
    const rows = buildForecast([], [{ dueDate: null, outstanding: 5000 }], 1000, '2026-04-01', 3)
    expect(rows.every((r) => r.projectedOutflow === 0)).toBe(true)
    expect(rows[rows.length - 1]!.runningBalance).toBe(1000) // unchanged by unscheduled payables
  })

  it('amounts beyond the horizon are dropped', () => {
    const rows = buildForecast([], [{ dueDate: d('2027-01-01'), outstanding: 800 }], 500, '2026-04-01', 3)
    expect(rows.every((r) => r.projectedOutflow === 0)).toBe(true)
  })
})

describe('unscheduledPayables', () => {
  it('sums only null-dueDate, positive-outstanding payables', () => {
    expect(unscheduledPayables([
      { dueDate: null, outstanding: 300 },
      { dueDate: null, outstanding: 200 },
      { dueDate: new Date(), outstanding: 999 }, // dated → excluded
      { dueDate: null, outstanding: 0 }, // non-positive → excluded
    ])).toBe(500)
  })
})
