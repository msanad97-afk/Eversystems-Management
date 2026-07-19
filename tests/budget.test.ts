import { describe, it, expect } from 'vitest'
import {
  deriveActivityBudget,
  deriveProjectBudget,
  mergeTotals,
  round,
  type ActivityInput,
} from '@/lib/budget'

const mason = (hpu: number) => ({ laborCategoryId: 'mason', laborCategoryName: 'Mason', hoursPerUnit: hpu })
const helper = (hpu: number) => ({ laborCategoryId: 'helper', laborCategoryName: 'Helper', hoursPerUnit: hpu })
const cement = (qpu: number) => ({ materialId: 'cement', materialName: 'OPC Cement', materialUnit: 'bag', qtyPerUnit: qpu })

// EIFS @ 1000 m2: base coat (Mason 0.3/m2, Cement 0.5/m2), finish (Helper 0.2/m2), scaffolding lumpsum 2500.
const eifs: ActivityInput = {
  id: 'a', ref: null, name: 'EIFS', type: 'MEASURED', unit: 'm2', boqQuantity: 1000, lumpsumBhd: null,
  subActivities: [
    { id: 's1', name: 'Base coat', type: 'MEASURED', isImplicit: false, lumpsumBhd: null, manpower: [mason(0.3)], materials: [cement(0.5)] },
    { id: 's2', name: 'Finish', type: 'MEASURED', isImplicit: false, lumpsumBhd: null, manpower: [helper(0.2)], materials: [] },
    { id: 's3', name: 'Scaffolding', type: 'LUMPSUM', isImplicit: false, lumpsumBhd: 2500, manpower: [], materials: [] },
  ],
}

describe('round', () => {
  it('keeps float products clean', () => {
    expect(round(0.3 * 1000)).toBe(300)
    expect(round(0.1 + 0.2, 4)).toBe(0.3)
  })
})

describe('deriveActivityBudget — measured', () => {
  const b = deriveActivityBudget(eifs)
  it('derives hours = rate × quantity, summed by trade', () => {
    expect(b.totals.manpower.find((m) => m.laborCategoryId === 'mason')!.hours).toBe(300) // 0.3 × 1000
    expect(b.totals.manpower.find((m) => m.laborCategoryId === 'helper')!.hours).toBe(200) // 0.2 × 1000
  })
  it('derives material qty = rate × quantity', () => {
    expect(b.totals.materials.find((m) => m.materialId === 'cement')!.quantity).toBe(500) // 0.5 × 1000
  })
  it('carries the lumpsum sub-activity BHD onto the lumpsum side, separately', () => {
    expect(b.totals.lumpsumBhd).toBe(2500)
  })
  it('scales the measured side with the placed quantity', () => {
    const half = deriveActivityBudget({ ...eifs, boqQuantity: 500 })
    expect(half.totals.manpower.find((m) => m.laborCategoryId === 'mason')!.hours).toBe(150)
    expect(half.totals.lumpsumBhd).toBe(2500) // lumpsum does NOT scale
  })
})

describe('deriveActivityBudget — pure lumpsum', () => {
  const lump: ActivityInput = {
    id: 'l', ref: null, name: 'Mobilisation', type: 'LUMPSUM', unit: null, boqQuantity: 0, lumpsumBhd: 1200.5, subActivities: [],
  }
  it('is a fixed BHD with no measured side, and does not scale', () => {
    expect(deriveActivityBudget(lump).totals).toEqual({ manpower: [], materials: [], lumpsumBhd: 1200.5 })
  })
})

describe('project rollup keeps measured and lumpsum on SEPARATE scorecards', () => {
  const project = deriveProjectBudget('p', 'Proj', [
    { assetId: 'as1', assetName: 'Villa A', activities: [eifs] },
    {
      assetId: 'as2',
      assetName: 'Site',
      activities: [{ id: 'l', ref: null, name: 'Mobilisation', type: 'LUMPSUM', unit: null, boqQuantity: 0, lumpsumBhd: 1000, subActivities: [] }],
    },
  ])
  it('sums each side independently — never combined into one number', () => {
    expect(project.totals.lumpsumBhd).toBe(3500) // 2500 + 1000
    expect(project.totals.manpower.find((m) => m.laborCategoryId === 'mason')!.hours).toBe(300)
    // measured hours and BHD live in different fields; there is no single blended total
    expect(project.totals).toHaveProperty('manpower')
    expect(project.totals).toHaveProperty('lumpsumBhd')
  })
})

describe('mergeTotals', () => {
  it('adds hours per trade across parts', () => {
    const merged = mergeTotals([
      { manpower: [{ laborCategoryId: 'mason', laborCategoryName: 'Mason', hours: 10 }], materials: [], lumpsumBhd: 0 },
      { manpower: [{ laborCategoryId: 'mason', laborCategoryName: 'Mason', hours: 5 }], materials: [], lumpsumBhd: 0 },
      { manpower: [{ laborCategoryId: 'helper', laborCategoryName: 'Helper', hours: 4 }], materials: [], lumpsumBhd: 100 },
    ])
    expect(merged.manpower.find((m) => m.laborCategoryId === 'mason')!.hours).toBe(15)
    expect(merged.manpower.find((m) => m.laborCategoryId === 'helper')!.hours).toBe(4)
    expect(merged.lumpsumBhd).toBe(100)
  })
})
