import { describe, it, expect } from 'vitest'
import {
  progressFraction, certifiedMeasured, certifiedLumpsum, deriveAssetValuation,
  deriveValuationCumulative, computePeriod, periodEnd, revisionCode, baseCode,
  expectedReceiptDate, isPeriodMonth,
  type ValuationActivityInput, type ValuationAssetInput,
} from '@/lib/valuation'

const activity = (o: Partial<ValuationActivityInput> = {}): ValuationActivityInput => ({
  activityId: 'a1', type: 'MEASURED', billRate: 10, boqQuantity: 100, measuredEv: 0, measuredBv: 0, ...o,
})
const asset = (o: Partial<ValuationAssetInput> = {}): ValuationAssetInput => ({
  assetId: 'as1', assetName: 'Block A', sortOrder: 0, lumpsumRevenue: null, lumpsumEv: 0, lumpsumBv: 0, activities: [], ...o,
})

describe('progress fraction — the 6C EV/BV ratio', () => {
  it('is EV ÷ BV', () => {
    expect(progressFraction(250, 1000)).toBe(0.25)
  })
  it('guards a zero denominator (nothing budgeted → nothing certified)', () => {
    expect(progressFraction(500, 0)).toBe(0)
  })
  it('never exceeds 1, so a certificate cannot exceed contract value', () => {
    expect(progressFraction(1500, 1000)).toBe(1)
  })
})

describe('certified measured value — multi-stage safe', () => {
  it('single-sub activity reduces to min(qty, BOQ) × billRate', () => {
    // One sub, BV 4000, 25% done → EV 1000. billRate 10 × BOQ 100 × 0.25 = 250.
    expect(certifiedMeasured(activity({ measuredEv: 1000, measuredBv: 4000 }))).toBe(250)
  })

  it('a MULTI-STAGE activity certifies at its BV-weighted %, not the sum of sub-quantities', () => {
    // Three parallel stage subs on the SAME 100 m² BOQ: BV 1000 each; only stage 1 complete.
    // BV-weighted % = 1000/3000 = 33.33% → 10 × 100 × 0.3333 = 333.30.
    // Summing sub-quantities would have read 100/100 = 100% → 1000.000, a 3× over-bill.
    const multi = certifiedMeasured(activity({ measuredEv: 1000, measuredBv: 3000 }))
    expect(multi).toBeCloseTo(333.3, 1)
    expect(multi).toBeLessThan(1000)
  })

  it('never exceeds contract value even when every stage is complete', () => {
    expect(certifiedMeasured(activity({ measuredEv: 3000, measuredBv: 3000 }))).toBe(1000) // = billRate × BOQ
  })

  it('a missing bill rate certifies at zero', () => {
    expect(certifiedMeasured(activity({ billRate: null, measuredEv: 3000, measuredBv: 3000 }))).toBe(0)
  })
})

describe('certified lumpsum value — asset-level revenue × cost-progress fraction', () => {
  it('is the EV/BV fraction × Asset.lumpsumRevenue', () => {
    // Lumpsum COST budget 2000, 1500 earned → 75%. Agreed REVENUE 4000 → 3000.
    // Note the revenue base is NOT the earned cost (1500) — different quantities.
    expect(certifiedLumpsum(asset({ lumpsumRevenue: 4000, lumpsumEv: 1500, lumpsumBv: 2000 }))).toBe(3000)
  })
  it('a null lumpsumRevenue certifies at zero', () => {
    expect(certifiedLumpsum(asset({ lumpsumRevenue: null, lumpsumEv: 1500, lumpsumBv: 2000 }))).toBe(0)
  })
  it('no lumpsum budget → zero, never NaN', () => {
    expect(certifiedLumpsum(asset({ lumpsumRevenue: 4000, lumpsumEv: 0, lumpsumBv: 0 }))).toBe(0)
  })
})

describe('roll-up', () => {
  const a = asset({
    lumpsumRevenue: 4000, lumpsumEv: 1000, lumpsumBv: 2000, // 50% → 2000
    activities: [
      activity({ activityId: 'a1', measuredEv: 1000, measuredBv: 4000 }), // 250
      activity({ activityId: 'a2', billRate: 5, boqQuantity: 200, measuredEv: 500, measuredBv: 1000 }), // 5×200×0.5 = 500
    ],
  })

  it('asset gross = measured + lumpsum', () => {
    const line = deriveAssetValuation(a)
    expect(line.cumulativeMeasured).toBe(750)
    expect(line.cumulativeLumpsum).toBe(2000)
    expect(line.cumulativeGross).toBe(2750)
  })

  it('project cumulative = Σ assets, and lines are preserved', () => {
    const c = deriveValuationCumulative([a, asset({ assetId: 'as2', assetName: 'Block B', sortOrder: 1 })])
    expect(c.lines).toHaveLength(2)
    expect(c.cumulativeMeasured).toBe(750)
    expect(c.cumulativeLumpsum).toBe(2000)
    expect(c.cumulativeGross).toBe(2750)
    expect(c.lines[1]!.cumulativeGross).toBe(0)
  })
})

describe('period arithmetic — cumulative minus previous', () => {
  const base = {
    contractValue: 100_000, retentionPct: 10, retentionCapPct: null,
    advancePct: null, advanceRecoveredToDate: 0, previousRetentionHeld: 0,
  }

  it('first certificate bills the whole cumulative', () => {
    const p = computePeriod({ ...base, cumulativeGross: 20_000, previousGross: 0 })
    expect(p.grossThisPeriod).toBe(20_000)
    expect(p.retentionHeld).toBe(2000) // 10% of cumulative
    expect(p.retentionThisPeriod).toBe(2000)
    expect(p.netThisPeriod).toBe(18_000)
    expect(p.progressPct).toBe(20)
  })

  it('the second period bills ONLY the increment', () => {
    const p = computePeriod({ ...base, cumulativeGross: 35_000, previousGross: 20_000, previousRetentionHeld: 2000 })
    expect(p.grossThisPeriod).toBe(15_000)
    expect(p.retentionHeld).toBe(3500)
    expect(p.retentionThisPeriod).toBe(1500)
    expect(p.netThisPeriod).toBe(13_500)
  })

  it('a downward re-measure yields a legitimate NEGATIVE period — not clamped', () => {
    const p = computePeriod({ ...base, cumulativeGross: 18_000, previousGross: 20_000, previousRetentionHeld: 2000 })
    expect(p.grossThisPeriod).toBe(-2000)
    expect(p.retentionThisPeriod).toBe(-200) // retention released with the reversal
    expect(p.netThisPeriod).toBe(-1800)
  })

  it('a null retentionPct simply means the contract holds none', () => {
    const p = computePeriod({ ...base, retentionPct: null, cumulativeGross: 20_000, previousGross: 0 })
    expect(p.retentionHeld).toBe(0)
    expect(p.netThisPeriod).toBe(20_000)
  })

  it('progressPct guards a zero contract value', () => {
    expect(computePeriod({ ...base, contractValue: 0, cumulativeGross: 500, previousGross: 0 }).progressPct).toBe(0)
  })
})

describe('retention cap', () => {
  // Retain 10% of cumulative gross, but never more than 5% of the 100,000 contract = 5,000.
  const capped = { contractValue: 100_000, retentionPct: 10, retentionCapPct: 5, advancePct: null, advanceRecoveredToDate: 0 }

  it('accrues normally below the cap', () => {
    const p = computePeriod({ ...capped, cumulativeGross: 40_000, previousGross: 0, previousRetentionHeld: 0 })
    expect(p.retentionHeld).toBe(4000)
  })

  it('STOPS at the cap once held retention reaches it', () => {
    const p = computePeriod({ ...capped, cumulativeGross: 80_000, previousGross: 40_000, previousRetentionHeld: 4000 })
    expect(p.retentionHeld).toBe(5000) // 10% of 80k = 8k, capped at 5k
    expect(p.retentionThisPeriod).toBe(1000) // only the last 1,000 accrues
    expect(p.netThisPeriod).toBe(39_000)
  })

  it('holds flat once fully capped — later periods deduct no more retention', () => {
    const p = computePeriod({ ...capped, cumulativeGross: 100_000, previousGross: 80_000, previousRetentionHeld: 5000 })
    expect(p.retentionHeld).toBe(5000)
    expect(p.retentionThisPeriod).toBe(0)
    expect(p.netThisPeriod).toBe(20_000)
  })
})

describe('advance recovery', () => {
  // 20% advance on a 100,000 contract = 20,000 to recover, pro-rata at 20% of each period.
  const adv = { contractValue: 100_000, retentionPct: null, retentionCapPct: null, previousRetentionHeld: 0, advancePct: 20 }

  it('recovers pro-rata of this period’s gross', () => {
    const p = computePeriod({ ...adv, cumulativeGross: 30_000, previousGross: 0, advanceRecoveredToDate: 0 })
    expect(p.advanceRecovery).toBe(6000) // 20% of 30,000
    expect(p.netThisPeriod).toBe(24_000)
  })

  it('STOPS at full recovery — never recovers more than the advance', () => {
    // 19,000 already recovered; only 1,000 outstanding even though 20% of 40,000 is 8,000.
    const p = computePeriod({ ...adv, cumulativeGross: 90_000, previousGross: 50_000, advanceRecoveredToDate: 19_000 })
    expect(p.advanceRecovery).toBe(1000)
    expect(p.netThisPeriod).toBe(39_000)
  })

  it('recovers nothing once the advance is fully repaid', () => {
    const p = computePeriod({ ...adv, cumulativeGross: 100_000, previousGross: 90_000, advanceRecoveredToDate: 20_000 })
    expect(p.advanceRecovery).toBe(0)
    expect(p.netThisPeriod).toBe(10_000)
  })

  it('un-recovers on a negative period, but never more than was recovered', () => {
    const p = computePeriod({ ...adv, cumulativeGross: 40_000, previousGross: 50_000, advanceRecoveredToDate: 1000 })
    expect(p.advanceRecovery).toBe(-1000) // 20% of −10,000 is −2,000; capped at what was taken
  })

  it('a null advancePct recovers nothing', () => {
    const p = computePeriod({ ...adv, advancePct: null, cumulativeGross: 30_000, previousGross: 0, advanceRecoveredToDate: 0 })
    expect(p.advanceRecovery).toBe(0)
  })
})

describe('period + code helpers', () => {
  it('periodEnd is the last day of the month, UTC', () => {
    expect(periodEnd('2026-02-01').toISOString().slice(0, 10)).toBe('2026-02-28')
    expect(periodEnd('2026-01-01').toISOString().slice(0, 10)).toBe('2026-01-31')
  })
  it('only accepts a first-of-month period', () => {
    expect(isPeriodMonth('2026-03-01')).toBe(true)
    expect(isPeriodMonth('2026-03-15')).toBe(false)
    expect(isPeriodMonth('nonsense')).toBe(false)
  })
  it('revision 0 keeps the base code; later revisions suffix it', () => {
    expect(revisionCode('VAL-2026-0003', 0)).toBe('VAL-2026-0003')
    expect(revisionCode('VAL-2026-0003', 2)).toBe('VAL-2026-0003-r2')
    expect(baseCode('VAL-2026-0003-r2')).toBe('VAL-2026-0003')
    expect(baseCode('VAL-2026-0003')).toBe('VAL-2026-0003')
  })
  it('expected receipt = certified date + payment terms; null terms → null', () => {
    const at = new Date('2026-03-10T09:30:00.000Z')
    expect(expectedReceiptDate(at, 45)!.toISOString().slice(0, 10)).toBe('2026-04-24')
    expect(expectedReceiptDate(at, null)).toBeNull()
  })
})
