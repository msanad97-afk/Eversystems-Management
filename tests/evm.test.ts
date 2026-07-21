import { describe, it, expect } from 'vitest'
import {
  computeEvm, computeEvmCostOnly, measuredPercent, lumpsumPercent, earnedValue,
  interpolateCumPct, plannedValue, validateBaseline, monthRange, monthEnd, type BaselinePoint,
} from '@/lib/evm'

describe('percent complete — bottom-up only', () => {
  it('measured = approvedQty / plannedQty', () => {
    expect(measuredPercent(250, 1000)).toBe(0.25)
  })
  it('CAPS at 100% so over-delivery never inflates EV beyond BV', () => {
    expect(measuredPercent(1500, 1000)).toBe(1)
    expect(earnedValue(4000, measuredPercent(1500, 1000))).toBe(4000) // EV never exceeds BV
  })
  it('guards a zero/absent planned quantity', () => {
    expect(measuredPercent(50, 0)).toBe(0)
  })
  it('lumpsum uses the LATEST approved cumulative %, normalised ÷100', () => {
    expect(lumpsumPercent(40)).toBe(0.4)
    expect(lumpsumPercent(null)).toBe(0)
    expect(lumpsumPercent(150)).toBe(1) // clamped
  })
})

describe('point metrics (hand-computed)', () => {
  // BAC 1000, PV 500, EV 400, AC 500
  const m = computeEvm({ bac: 1000, pv: 500, ev: 400, ac: 500 })
  it('SV / CV', () => {
    expect(m.sv).toBe(-100) // 400 − 500, behind plan
    expect(m.cv).toBe(-100) // 400 − 500, over cost
  })
  it('SPI / CPI', () => {
    expect(m.spi).toBe(0.8) // 400/500
    expect(m.cpi).toBe(0.8) // 400/500
  })
  it('EAC primary assumes cost performance continues; independent assumes rest to budget', () => {
    expect(m.eac).toBe(1250) // 500 + (1000−400)/0.8
    expect(m.eacIndependent).toBe(1100) // 500 + (1000−400)
  })
  it('ETC / VAC / value-weighted % complete', () => {
    expect(m.etc).toBe(750) // 1250 − 500
    expect(m.vac).toBe(-250) // 1000 − 1250, forecast overrun
    expect(m.pctComplete).toBe(40) // EV/BAC
  })
})

describe('divide-by-zero guards — no Infinity/NaN reaches the UI', () => {
  it('AC = 0 → CPI null, EAC falls back to the independent form', () => {
    const m = computeEvm({ bac: 1000, pv: 500, ev: 400, ac: 0 })
    expect(m.cpi).toBeNull()
    expect(m.eac).toBe(600) // 0 + (1000−400)
    expect(Number.isFinite(m.eac)).toBe(true)
  })
  it('no baseline → PV/SV/SPI null', () => {
    const m = computeEvm({ bac: 1000, pv: null, ev: 400, ac: 500 })
    expect(m.pv).toBeNull()
    expect(m.spi).toBeNull()
    expect(m.sv).toBeNull()
  })
  it('BAC = 0 → pctComplete 0, never NaN', () => {
    expect(computeEvm({ bac: 0, pv: null, ev: 0, ac: 0 }).pctComplete).toBe(0)
  })
  it('below project level there is no PV/SPI/SV at all', () => {
    const node = computeEvmCostOnly({ bac: 1000, ev: 400, ac: 500 })
    expect(node).not.toHaveProperty('pv')
    expect(node).not.toHaveProperty('spi')
    expect(node).not.toHaveProperty('sv')
    expect(node.cpi).toBe(0.8)
  })
})

describe('roll-up is ratio-of-sums, never an average of child indices', () => {
  it('differs from averaging — and the sums are what count', () => {
    // Child A: EV 100 / AC 50 (CPI 2.0). Child B: EV 100 / AC 200 (CPI 0.5).
    const parent = computeEvmCostOnly({ bac: 400, ev: 200, ac: 250 })
    expect(parent.cpi).toBe(0.8) // 200/250 — NOT (2.0 + 0.5)/2 = 1.25
  })
})

describe('baseline curve', () => {
  const curve: BaselinePoint[] = [
    { periodMonth: '2026-01-01', cumPlannedPct: 20 },
    { periodMonth: '2026-02-01', cumPlannedPct: 60 },
    { periodMonth: '2026-03-01', cumPlannedPct: 100 },
  ]
  it('anchors on MONTH-END values', () => {
    expect(interpolateCumPct(curve, monthEnd('2026-01-01'))).toBe(20)
    expect(interpolateCumPct(curve, monthEnd('2026-02-01'))).toBe(60)
  })
  it('interpolates linearly by calendar day between month-ends', () => {
    // 2026-02-14 sits partway from 31 Jan (20%) to 28 Feb (60%).
    const pct = interpolateCumPct(curve, new Date('2026-02-14T00:00:00.000Z'))!
    expect(pct).toBeGreaterThan(20)
    expect(pct).toBeLessThan(60)
  })
  it('clamps after the final month and returns null with no baseline', () => {
    expect(interpolateCumPct(curve, new Date('2027-01-01T00:00:00.000Z'))).toBe(100)
    expect(interpolateCumPct([], new Date())).toBeNull()
  })
  it('PV = cumPct/100 × BAC', () => {
    expect(plannedValue(curve, monthEnd('2026-02-01'), 1000)).toBe(600)
    expect(plannedValue([], new Date(), 1000)).toBeNull()
  })
})

describe('baseline validation (server rules)', () => {
  const ok: BaselinePoint[] = [
    { periodMonth: '2026-01-01', cumPlannedPct: 30 },
    { periodMonth: '2026-02-01', cumPlannedPct: 100 },
  ]
  it('accepts a contiguous, non-decreasing curve ending at 100', () => {
    expect(validateBaseline(ok)).toEqual([])
  })
  it('accepts an empty curve (clears the baseline)', () => {
    expect(validateBaseline([])).toEqual([])
  })
  it('rejects a decreasing curve', () => {
    const bad = [{ periodMonth: '2026-01-01', cumPlannedPct: 60 }, { periodMonth: '2026-02-01', cumPlannedPct: 40 }]
    expect(validateBaseline(bad).some((e) => /cannot go down/i.test(e.message))).toBe(true)
  })
  it('rejects a month gap', () => {
    const bad = [{ periodMonth: '2026-01-01', cumPlannedPct: 30 }, { periodMonth: '2026-03-01', cumPlannedPct: 100 }]
    expect(validateBaseline(bad).some((e) => /contiguous/i.test(e.message))).toBe(true)
  })
  it('rejects a curve that does not end at 100%', () => {
    const bad = [{ periodMonth: '2026-01-01', cumPlannedPct: 30 }, { periodMonth: '2026-02-01', cumPlannedPct: 90 }]
    expect(validateBaseline(bad).some((e) => /100%/.test(e.message))).toBe(true)
  })
  it('rejects a non-first-of-month date and an out-of-range percent', () => {
    expect(validateBaseline([{ periodMonth: '2026-01-15', cumPlannedPct: 100 }]).length).toBeGreaterThan(0)
    expect(validateBaseline([{ periodMonth: '2026-01-01', cumPlannedPct: 120 }]).length).toBeGreaterThan(0)
  })
})

describe('monthRange', () => {
  it('is inclusive of both ends', () => {
    expect(monthRange(new Date('2026-01-15T00:00:00Z'), new Date('2026-03-02T00:00:00Z')))
      .toEqual(['2026-01-01', '2026-02-01', '2026-03-01'])
  })
})
