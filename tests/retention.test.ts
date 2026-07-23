import { describe, it, expect } from 'vitest'
import { retentionState, retentionInflows, addMonths } from '@/lib/cash'

const d = (s: string) => new Date(`${s}T00:00:00.000Z`)

describe('addMonths', () => {
  it('adds whole months, UTC', () => {
    expect(addMonths(d('2026-01-15'), 12).toISOString().slice(0, 10)).toBe('2027-01-15')
    expect(addMonths(d('2026-03-31'), 1).toISOString().slice(0, 10)).toBe('2026-04-30') // clamps to month end
  })
})

describe('retentionState — tranches from cumulative held', () => {
  it('splits held into first-release % and the balance, with due dates', () => {
    const s = retentionState(1000, 0, 50, d('2026-06-30'), 12)
    expect(s.held).toBe(1000)
    expect(s.outstanding).toBe(1000)
    expect(s.tranche1).toEqual({ amount: 500, due: d('2026-06-30'), remaining: 500 })
    expect(s.tranche2.amount).toBe(500)
    expect(s.tranche2.due!.toISOString().slice(0, 10)).toBe('2027-06-30') // PC + 12 months
    expect(s.tranche2.remaining).toBe(500)
  })

  it('defaults the first-release % to 50 when null', () => {
    expect(retentionState(1000, 0, null, d('2026-06-30'), 12).tranche1.amount).toBe(500)
  })

  it('a partial release pays down tranche 1 first, leaving the remainder', () => {
    const s = retentionState(1000, 300, 50, d('2026-06-30'), 12)
    expect(s.released).toBe(300)
    expect(s.outstanding).toBe(700)
    expect(s.tranche1.remaining).toBe(200) // 500 − 300
    expect(s.tranche2.remaining).toBe(500) // untouched
  })

  it('a release beyond tranche 1 spills into tranche 2', () => {
    const s = retentionState(1000, 700, 50, d('2026-06-30'), 12)
    expect(s.tranche1.remaining).toBe(0)
    expect(s.tranche2.remaining).toBe(300) // 500 − (700 − 500)
    expect(s.outstanding).toBe(300)
  })

  it('null completion date → both tranche dates null (tranche 2 needs the PC date)', () => {
    const s = retentionState(1000, 0, 50, null, 12)
    expect(s.tranche1.due).toBeNull()
    expect(s.tranche2.due).toBeNull()
  })

  it('null defects period → tranche 2 has no due date even with a PC date', () => {
    const s = retentionState(1000, 0, 50, d('2026-06-30'), null)
    expect(s.tranche1.due).not.toBeNull()
    expect(s.tranche2.due).toBeNull()
  })
})

describe('retentionInflows — dated tranches forecast, undated surfaced', () => {
  it('dated remaining tranches become forecast inflows', () => {
    const s = retentionState(1000, 0, 50, d('2026-06-30'), 12)
    const { inflows, unscheduled } = retentionInflows(s)
    expect(inflows).toHaveLength(2)
    expect(inflows[0]).toEqual({ expectedReceipt: d('2026-06-30'), outstanding: 500 })
    expect(unscheduled).toBe(0)
  })

  it('undated tranches become unscheduled retention, never an inflow', () => {
    const s = retentionState(1000, 0, 50, null, 12)
    const { inflows, unscheduled } = retentionInflows(s)
    expect(inflows).toHaveLength(0)
    expect(unscheduled).toBe(1000)
  })

  it('a fully-released tranche contributes nothing', () => {
    const s = retentionState(1000, 1000, 50, d('2026-06-30'), 12)
    const { inflows, unscheduled } = retentionInflows(s)
    expect(inflows).toHaveLength(0)
    expect(unscheduled).toBe(0)
    expect(s.outstanding).toBe(0)
  })
})
