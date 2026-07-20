import { describe, it, expect } from 'vitest'
import { deriveActivityMoney, deriveProjectMoney, type MoneyActivity } from '@/lib/money'

const measured = (over: Partial<MoneyActivity> = {}): MoneyActivity => ({
  id: 'a1', ref: null, name: 'EIFS', type: 'MEASURED', unit: 'm2', boqQuantity: 1000,
  lumpsumBhd: null, costRate: null, billRate: null,
  subActivities: [{
    id: 's1', name: 'Base coat', type: 'MEASURED', lumpsumBhd: null,
    manpower: [{ laborCategoryId: 'mason', laborCategoryName: 'Mason', hoursPerUnit: 0.3, costRateAtPlacement: 2 }],
    materials: [{ materialId: 'cement', materialName: 'Cement', materialUnit: 'bag', qtyPerUnit: 0.5, costRateAtPlacement: 1.5 }],
  }],
  ...over,
})

describe('measured cost build-up', () => {
  it('prices hours and quantities at the frozen rates', () => {
    const m = deriveActivityMoney(measured())
    expect(m.costBudget).toBe(1350) // 0.3×1000×2 + 0.5×1000×1.5
    expect(m.costSource).toBe('BUILD_UP')
  })
  it('uses costRate as a fallback only when there is no build-up', () => {
    const bare = measured({ subActivities: [{ id: 's', name: '__implicit__', type: 'MEASURED', lumpsumBhd: null, manpower: [], materials: [] }], costRate: 4 })
    const m = deriveActivityMoney(bare)
    expect(m.costBudget).toBe(4000) // 4 × 1000
    expect(m.costSource).toBe('RATE_FALLBACK')
  })
})

/**
 * The core correctness rule: a lumpsum is a COST to complete the activity. It raises the cost
 * budget (BAC) and contributes NOTHING to contract value — billing happens at asset/project
 * level, never on an activity line.
 */
describe('lumpsum is a cost, not revenue', () => {
  const lumpsumSub = { id: 's2', name: 'Scaffolding', type: 'LUMPSUM' as const, lumpsumBhd: 2500, manpower: [], materials: [] }

  it('raises the cost budget and leaves contract value untouched', () => {
    const mixed = measured({ billRate: 5, subActivities: [...measured().subActivities, lumpsumSub] })
    const m = deriveActivityMoney(mixed)
    expect(m.costBudget).toBe(3850) // 1350 measured build-up + 2500 lumpsum COST
    expect(m.contractValue).toBe(5000) // billRate 5 × 1000 ONLY — the lumpsum adds nothing
    expect(m.margin).toBe(1150) // 5000 − 3850
    expect(m.costSource).toBe('MIXED')
  })

  it('gives a pure-lumpsum activity zero contract value and a negative margin', () => {
    const pure = deriveActivityMoney(measured({
      type: 'LUMPSUM', unit: null, boqQuantity: 0, lumpsumBhd: 2500, subActivities: [],
    }))
    expect(pure.costBudget).toBe(2500)
    expect(pure.contractValue).toBe(0)
    // Negative margin is the CORRECT reading — real cost, no revenue recorded against it.
    expect(pure.margin).toBe(-2500)
    expect(pure.costSource).toBe('LUMPSUM')
  })

  it('does not treat a lumpsum sub-activity as revenue even with no measured bill rate', () => {
    const m = deriveActivityMoney(measured({ billRate: null, subActivities: [lumpsumSub] }))
    expect(m.contractValue).toBe(0)
    expect(m.costBudget).toBe(2500)
  })

  it('rolls lumpsum cost into BAC without inflating project contract value', () => {
    const p = deriveProjectMoney(
      'p', 'Proj',
      [{ assetId: 'as1', assetName: 'Villa A', activities: [measured({ billRate: 5, subActivities: [...measured().subActivities, lumpsumSub] })] }],
      { budgetCost: null, contractValue: null },
    )
    expect(p.bac).toBe(3850)
    expect(p.contractValue).toBe(5000)
    expect(p.margin).toBe(1150)
  })
})

describe('unpriced detection', () => {
  it('flags resources with no frozen rate and excludes them from the budget', () => {
    const m = deriveActivityMoney(measured({
      subActivities: [{
        id: 's1', name: 'Base coat', type: 'MEASURED', lumpsumBhd: null,
        manpower: [{ laborCategoryId: 'mason', laborCategoryName: 'Mason', hoursPerUnit: 0.3, costRateAtPlacement: null }],
        materials: [{ materialId: 'cement', materialName: 'Cement', materialUnit: 'bag', qtyPerUnit: 0.5, costRateAtPlacement: 1.5 }],
      }],
    }))
    expect(m.costBudget).toBe(750) // only the priced material
    expect(m.unpriced.find((u) => u.kind === 'LABOUR')?.resourceName).toBe('Mason')
  })
  it('flags a measured activity with no bill rate', () => {
    expect(deriveActivityMoney(measured()).unpriced.some((u) => u.kind === 'ACTIVITY_BILL')).toBe(true)
  })
})

describe('project rollup + header divergence', () => {
  const build = (header: { budgetCost: number | null; contractValue: number | null }) =>
    deriveProjectMoney('p', 'Proj', [{ assetId: 'as1', assetName: 'Villa A', activities: [measured({ billRate: 5 })] }], header)

  it('rolls up BAC, contract value and margin %', () => {
    const p = build({ budgetCost: null, contractValue: null })
    expect(p.bac).toBe(1350)
    expect(p.contractValue).toBe(5000)
    expect(p.margin).toBe(3650)
    expect(p.marginPct).toBe(73)
    expect(p.header.diverged).toBe(false)
  })
  it('flags divergence against the typed header figures', () => {
    const p = build({ budgetCost: 1000, contractValue: 5000 })
    expect(p.header.costDivergence).toBe(350) // 1350 build-up − 1000 header
    expect(p.header.contractDivergence).toBe(0)
    expect(p.header.diverged).toBe(true)
  })
})
