import { describe, it, expect } from 'vitest'
import { deriveSubConsumption, storeExact } from '@/lib/consumption/derive'
import { formatConsumptionQty, isCountableUnit } from '@/lib/consumption/format'

describe('deriveSubConsumption', () => {
  it('untouched budget material → ESTIMATED with the exact unrounded value + snapshotted rate', () => {
    // 0.28 bag/m² × 70 m² = 19.6 bags — stored exact, NOT display-rounded to 20.
    const out = deriveSubConsumption(70, [{ materialId: 'm', unit: 'bag', estimateRate: 0.28 }], [])
    expect(out).toEqual([{ materialId: 'm', unit: 'bag', quantity: 19.6, source: 'ESTIMATED', estimateRate: 0.28 }])
  })

  it('edited (touched) budget material → ACTUAL with the typed value, rate still recorded', () => {
    const out = deriveSubConsumption(70, [{ materialId: 'm', unit: 'bag', estimateRate: 0.28 }], [{ materialId: 'm', unit: 'bag', quantity: 18, touched: true }])
    expect(out[0]).toEqual({ materialId: 'm', unit: 'bag', quantity: 18, source: 'ACTUAL', estimateRate: 0.28 })
  })

  it('untouched pre-filled row (stored rounded 20) → ESTIMATED recomputed exact, ignoring the stored value', () => {
    // The row carries the rounded display value 20, but is untouched → server recomputes 0.28 × 70 = 19.6.
    const out = deriveSubConsumption(70, [{ materialId: 'm', unit: 'bag', estimateRate: 0.28 }], [{ materialId: 'm', unit: 'bag', quantity: 20, touched: false }])
    expect(out[0]).toEqual({ materialId: 'm', unit: 'bag', quantity: 19.6, source: 'ESTIMATED', estimateRate: 0.28 })
  })

  it('a logged material with no budget rate → ACTUAL, no estimateRate', () => {
    const out = deriveSubConsumption(70, [], [{ materialId: 'x', unit: 'kg', quantity: 5.25, touched: true }])
    expect(out).toEqual([{ materialId: 'x', unit: 'kg', quantity: 5.25, source: 'ACTUAL', estimateRate: null }])
  })

  it('storeExact keeps 3-dp precision (never display rounding)', () => {
    expect(storeExact(0.28 * 70)).toBe(19.6)
    expect(storeExact(19.6666)).toBe(19.667)
  })
})

describe('formatConsumptionQty (display only)', () => {
  it('countable units render whole, continuous units render one decimal', () => {
    expect(formatConsumptionQty(19.6, 'bag')).toBe('20')
    expect(formatConsumptionQty(19.6, 'bags')).toBe('20')
    expect(formatConsumptionQty(3.4, 'sheet')).toBe('3')
    expect(formatConsumptionQty(19.64, 'kg')).toBe('19.6')
    expect(formatConsumptionQty(2.5, 'm2')).toBe('2.5')
    expect(isCountableUnit('drum')).toBe(true)
    expect(isCountableUnit('litre')).toBe(false)
  })
})
