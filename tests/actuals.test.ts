import { describe, it, expect } from 'vitest'
import { trafficLight, varianceLine, buildMeasuredVariance, lumpsumEarned, worstLight } from '@/lib/actuals'
import type { BudgetTotals } from '@/lib/budget'

describe('trafficLight (green <90%, amber 90–100%, red >100%)', () => {
  it('classifies consumed %', () => {
    expect(trafficLight(89, 100)).toBe('green')
    expect(trafficLight(90, 100)).toBe('amber')
    expect(trafficLight(100, 100)).toBe('amber')
    expect(trafficLight(101, 100)).toBe('red')
  })
  it('no budget → none when unused, red when actuals exist', () => {
    expect(trafficLight(0, 0)).toBe('none')
    expect(trafficLight(5, 0)).toBe('red')
  })
})

describe('varianceLine', () => {
  it('computes variance, consumed %, and light', () => {
    const l = varianceLine('mason', 'Mason', 'hrs', 300, 234)
    expect(l.variance).toBe(66) // 300 − 234 under budget
    expect(l.consumedPct).toBe(78)
    expect(l.light).toBe('green')
  })
  it('flags over-budget red', () => {
    expect(varianceLine('m', 'M', 'hrs', 300, 330).light).toBe('red')
  })
})

describe('buildMeasuredVariance', () => {
  const budget: BudgetTotals = {
    manpower: [{ laborCategoryId: 'mason', laborCategoryName: 'Mason', hours: 300 }],
    materials: [{ materialId: 'cement', materialName: 'OPC Cement', materialUnit: 'bag', quantity: 500 }],
    lumpsumBhd: 0,
  }
  it('lines up budget vs actual per trade/material, worst light bubbles up', () => {
    const v = buildMeasuredVariance(budget, {
      manpower: [{ laborCategoryId: 'mason', laborCategoryName: 'Mason', hours: 330 }], // over → red
      materials: [{ materialId: 'cement', materialName: 'OPC Cement', materialUnit: 'bag', quantity: 400 }], // 80% → green
    })
    expect(v.labour[0]!.light).toBe('red')
    expect(v.materials[0]!.consumedPct).toBe(80)
    expect(v.worstLight).toBe('red')
  })
  it('surfaces an actual on an un-budgeted trade as over-budget', () => {
    const v = buildMeasuredVariance({ manpower: [], materials: [], lumpsumBhd: 0 }, {
      manpower: [{ laborCategoryId: 'x', laborCategoryName: 'Extra', hours: 10 }],
      materials: [],
    })
    expect(v.labour[0]!.light).toBe('red')
    expect(v.labour[0]!.budget).toBe(0)
  })
})

describe('worstLight + lumpsumEarned', () => {
  it('worstLight picks the most severe', () => {
    expect(worstLight(['green', 'amber', 'green'])).toBe('amber')
    expect(worstLight(['green', 'red', 'amber'])).toBe('red')
    expect(worstLight([])).toBe('none')
  })
  it('lumpsum earned = % × BHD', () => {
    expect(lumpsumEarned(40, 2500)).toBe(1000)
    expect(lumpsumEarned(0, 2500)).toBe(0)
    expect(lumpsumEarned(100, 1200.5)).toBe(1200.5)
  })
})
