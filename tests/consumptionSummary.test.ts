import { describe, it, expect } from 'vitest'
import { aggregateConsumptionSummary } from '@/lib/consumption/summary'
import { applyEstimatePrefill } from '@/lib/consumption/prefill'

describe('aggregateConsumptionSummary', () => {
  it('sums one material budgeted on two sub-activities into ONE summary row', () => {
    const { rows } = aggregateConsumptionSummary([
      { type: 'MEASURED', quantityDone: 10, anyTouched: false, budgetMaterials: [{ materialId: 'cement', materialName: 'Cement', unit: 'bag', qtyPerUnit: 0.28 }] },
      { type: 'MEASURED', quantityDone: 20, anyTouched: false, budgetMaterials: [{ materialId: 'cement', materialName: 'Cement', unit: 'bag', qtyPerUnit: 0.28 }] },
    ])
    // 0.28×10 + 0.28×20 = 8.4 → display-rounded whole (countable unit) = 8
    expect(rows).toEqual([{ materialId: 'cement', name: 'Cement', quantity: '8', unit: 'bag' }])
  })

  it('keeps distinct materials as separate rows, sorted by name', () => {
    const { rows } = aggregateConsumptionSummary([
      { type: 'MEASURED', quantityDone: 100, anyTouched: false, budgetMaterials: [
        { materialId: 'sand', materialName: 'Sand', unit: 'm3', qtyPerUnit: 0.05 },
        { materialId: 'cement', materialName: 'Cement', unit: 'bag', qtyPerUnit: 0.28 },
      ] },
    ])
    expect(rows.map((r) => r.name)).toEqual(['Cement', 'Sand'])
  })

  it('excludes non-measured subs and zero-progress subs; reports anyTouched', () => {
    const res = aggregateConsumptionSummary([
      { type: 'LUMPSUM', quantityDone: 5, anyTouched: false, budgetMaterials: [{ materialId: 'x', materialName: 'X', unit: 'bag', qtyPerUnit: 1 }] },
      { type: 'MEASURED', quantityDone: 0, anyTouched: false, budgetMaterials: [{ materialId: 'y', materialName: 'Y', unit: 'bag', qtyPerUnit: 1 }] },
      { type: 'MEASURED', quantityDone: 3, anyTouched: true, budgetMaterials: [{ materialId: 'z', materialName: 'Z', unit: 'bag', qtyPerUnit: 1 }] },
    ])
    expect(res.rows.map((r) => r.materialId)).toEqual(['z'])
    expect(res.anyTouched).toBe(true)
  })
})

describe('applyEstimatePrefill', () => {
  const budget = [{ materialId: 'cement', unit: 'bag', qtyPerUnit: 0.28 }]

  it('pre-fills an untouched row with the display-rounded estimate', () => {
    const rows = [{ materialId: 'cement', quantity: '' }]
    const out = applyEstimatePrefill(rows, budget, 70)
    expect(out[0]!.quantity).toBe('20') // 0.28×70 = 19.6 → whole (countable) = 20
  })

  it('never overwrites a touched (typed) row', () => {
    const rows = [{ materialId: 'cement', quantity: '5', touched: true }]
    const out = applyEstimatePrefill(rows, budget, 70)
    expect(out[0]!.quantity).toBe('5')
  })

  it('recomputes untouched rows when quantity-done changes; clears when zero', () => {
    const rows = [{ materialId: 'cement', quantity: '20' }]
    expect(applyEstimatePrefill(rows, budget, 100)[0]!.quantity).toBe('28') // 0.28×100 = 28
    expect(applyEstimatePrefill(rows, budget, 0)[0]!.quantity).toBe('')
  })

  it('leaves rows with no matching budget untouched', () => {
    const rows = [{ materialId: 'other', quantity: '' }]
    expect(applyEstimatePrefill(rows, budget, 70)[0]!.quantity).toBe('')
  })
})
