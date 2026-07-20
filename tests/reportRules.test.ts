import { describe, it, expect } from 'vitest'
import {
  MAX_BACKDATE_DAYS,
  validateReportDate,
  canEdit,
  canSubmit,
  canRecall,
  canReview,
  validateForSubmit,
  validateSubActivities,
  subActivityError,
  capRemaining,
  cumulativePercent,
  computeManpowerTotals,
  computeReportTotals,
  type SubActivityInput,
} from '@/lib/reports/rules'

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

const measured = (over: Partial<SubActivityInput> = {}): SubActivityInput => ({
  subActivityId: 's1',
  label: 'Blockwork 200mm',
  type: 'MEASURED',
  unit: 'm2',
  quantityDone: 10,
  remaining: 100,
  percentComplete: 0,
  lastApprovedPercent: 0,
  manpower: [],
  materials: [],
  ...over,
})
const lumpsum = (over: Partial<SubActivityInput> = {}): SubActivityInput =>
  measured({ subActivityId: 'l1', label: 'Scaffolding', type: 'LUMPSUM', quantityDone: 0, ...over })

describe('validateReportDate', () => {
  const today = day('2026-07-14')
  it('accepts today', () => expect(validateReportDate(today, today)).toBeNull())
  it('rejects future dates', () => expect(validateReportDate(day('2026-07-15'), today)).toMatch(/Future/))
  it('accepts the oldest allowed backdate', () => {
    expect(MAX_BACKDATE_DAYS).toBe(7)
    expect(validateReportDate(day('2026-07-07'), today)).toBeNull()
  })
  it('rejects one day beyond the backdate limit', () => expect(validateReportDate(day('2026-07-06'), today)).toMatch(/backdated/))
})

describe('status transitions', () => {
  it('editable/submittable only in DRAFT or REJECTED', () => {
    expect(canEdit('DRAFT')).toBe(true)
    expect(canEdit('SUBMITTED')).toBe(false)
    expect(canSubmit('APPROVED')).toBe(false)
  })
  it('recallable/reviewable only from SUBMITTED; APPROVED terminal', () => {
    expect(canRecall('SUBMITTED')).toBe(true)
    expect(canReview('SUBMITTED')).toBe(true)
    expect(canReview('APPROVED')).toBe(false)
    expect(canEdit('APPROVED')).toBe(false)
  })
})

describe('measured cap (per sub-activity)', () => {
  it('capRemaining = boq − committed, never below 0', () => {
    expect(capRemaining(500, 250)).toBe(250)
    expect(capRemaining(500, 600)).toBe(0)
  })
  it('blocks over-cap and negative, allows the exact boundary', () => {
    expect(subActivityError(measured({ quantityDone: 300, remaining: 250 }))).toMatch(/exceeds the remaining/)
    expect(subActivityError(measured({ quantityDone: 250, remaining: 250 }))).toBeNull()
    expect(subActivityError(measured({ quantityDone: -1 }))).toMatch(/zero or more/)
  })
  it('validateSubActivities returns the first violation', () => {
    expect(validateSubActivities([measured({ quantityDone: 5 }), measured({ quantityDone: 999, remaining: 100 })])).toMatch(/exceeds/)
    expect(validateSubActivities([measured({ quantityDone: 5 })])).toBeNull()
  })
})

describe('lumpsum bounds (no regression)', () => {
  it('accepts 0–100 at or above the last approved %', () => {
    expect(subActivityError(lumpsum({ percentComplete: 60, lastApprovedPercent: 50 }))).toBeNull()
    expect(subActivityError(lumpsum({ percentComplete: 50, lastApprovedPercent: 50 }))).toBeNull()
  })
  it('rejects regressing below the last approved %', () => {
    expect(subActivityError(lumpsum({ percentComplete: 40, lastApprovedPercent: 50 }))).toMatch(/below the last approved/)
  })
  it('rejects out-of-range %', () => {
    expect(subActivityError(lumpsum({ percentComplete: 101 }))).toMatch(/between 0 and 100/)
    expect(subActivityError(lumpsum({ percentComplete: -5 }))).toMatch(/between 0 and 100/)
  })
})

describe('validateForSubmit (sub-activity-structured)', () => {
  it('requires at least one line with progress', () => {
    expect(validateForSubmit([measured({ quantityDone: 0 })])).toMatch(/at least one line/)
    expect(validateForSubmit([lumpsum({ percentComplete: 0 })])).toMatch(/at least one line/)
    expect(validateForSubmit([])).toMatch(/at least one line/)
  })
  it('accepts a lumpsum line with % > 0 as progress', () => {
    expect(validateForSubmit([lumpsum({ percentComplete: 25 })])).toBeNull()
  })
  it('blocks manpower headcount < 1 and hours <= 0', () => {
    expect(validateForSubmit([measured({ manpower: [{ categoryId: 'c', headcount: 0, hours: 8 }] })])).toMatch(/headcount/)
    expect(validateForSubmit([measured({ manpower: [{ categoryId: 'c', headcount: 3, hours: 0 }] })])).toMatch(/hours/)
  })
  it('blocks material quantity <= 0 and enforces the cap', () => {
    expect(validateForSubmit([measured({ materials: [{ materialId: 'm', quantity: 0 }] })])).toMatch(/quantity/)
    expect(validateForSubmit([measured({ quantityDone: 150, remaining: 100 })])).toMatch(/exceeds/)
  })
  it('allows a valid measured line with no manpower/materials', () => {
    expect(validateForSubmit([measured({ quantityDone: 10 })])).toBeNull()
  })
})

describe('cumulativePercent + totals', () => {
  it('earned/boq × 100, capped, zero-guarded', () => {
    expect(cumulativePercent(250, 500)).toBe(50)
    expect(cumulativePercent(600, 500)).toBe(100)
    expect(cumulativePercent(5, 0)).toBe(0)
  })
  it('computeManpowerTotals + computeReportTotals sum workers and man-hours', () => {
    expect(computeManpowerTotals([{ headcount: 10, hours: 8 }, { headcount: 3, hours: 8 }])).toEqual({ workers: 13, manHours: 104 })
    expect(computeReportTotals([{ manpower: [{ headcount: 10, hours: 8 }] }, { manpower: [{ headcount: 3, hours: 8 }] }])).toEqual({ workers: 13, manHours: 104 })
  })
})
