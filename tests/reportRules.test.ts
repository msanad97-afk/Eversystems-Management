import { describe, it, expect } from 'vitest'
import {
  MAX_BACKDATE_DAYS,
  validateReportDate,
  canEdit,
  canSubmit,
  canRecall,
  canReview,
  validateForSubmit,
  validateCaps,
  capErrorFor,
  capRemaining,
  cumulativePercent,
  computeManpowerTotals,
  computeReportTotals,
  type ActivityInput,
} from '@/lib/reports/rules'

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

const activity = (over: Partial<ActivityInput> = {}): ActivityInput => ({
  activityId: 'a1',
  activityName: 'Blockwork 200mm',
  unit: 'm2',
  quantityDone: 10,
  remaining: 100,
  manpower: [],
  materials: [],
  ...over,
})

describe('validateReportDate', () => {
  const today = day('2026-07-14')
  it('accepts today', () => expect(validateReportDate(today, today)).toBeNull())
  it('rejects future dates', () => expect(validateReportDate(day('2026-07-15'), today)).toMatch(/Future/))
  it('accepts the oldest allowed backdate', () => {
    expect(MAX_BACKDATE_DAYS).toBe(7)
    expect(validateReportDate(day('2026-07-07'), today)).toBeNull()
  })
  it('rejects one day beyond the backdate limit', () =>
    expect(validateReportDate(day('2026-07-06'), today)).toMatch(/backdated/))
})

describe('validateReportDate — Bahrain midnight-to-3am window', () => {
  const nowInWindow = new Date('2026-07-14T22:30:00Z') // 01:30 Bahrain on the 15th
  it('treats the local day (15th) as today', () =>
    expect(validateReportDate(day('2026-07-15'), nowInWindow)).toBeNull())
  it('still rejects the genuinely-future 16th', () =>
    expect(validateReportDate(day('2026-07-16'), nowInWindow)).toMatch(/Future/))
})

describe('status transitions', () => {
  it('editable/submittable only in DRAFT or REJECTED', () => {
    expect(canEdit('DRAFT')).toBe(true)
    expect(canEdit('REJECTED')).toBe(true)
    expect(canEdit('SUBMITTED')).toBe(false)
    expect(canSubmit('APPROVED')).toBe(false)
  })
  it('recallable/reviewable only from SUBMITTED', () => {
    expect(canRecall('SUBMITTED')).toBe(true)
    expect(canReview('SUBMITTED')).toBe(true)
    expect(canReview('DRAFT')).toBe(false)
  })
  it('APPROVED is terminal (approve locks permanently)', () => {
    expect(canEdit('APPROVED')).toBe(false)
    expect(canSubmit('APPROVED')).toBe(false)
    expect(canRecall('APPROVED')).toBe(false)
    expect(canReview('APPROVED')).toBe(false)
  })
})

describe('BOQ cap', () => {
  it('capRemaining = boq − committed, never below 0', () => {
    expect(capRemaining(500, 250)).toBe(250)
    expect(capRemaining(500, 600)).toBe(0)
  })
  it('capErrorFor blocks over-cap and negative, allows the exact boundary', () => {
    expect(capErrorFor(activity({ quantityDone: 300, remaining: 250 }))).toMatch(/exceeds the remaining/)
    expect(capErrorFor(activity({ quantityDone: 250, remaining: 250 }))).toBeNull()
    expect(capErrorFor(activity({ quantityDone: -1, remaining: 250 }))).toMatch(/zero or more/)
  })
  it('validateCaps returns the first violation', () => {
    expect(
      validateCaps([activity({ quantityDone: 5, remaining: 100 }), activity({ quantityDone: 999, remaining: 100 })]),
    ).toMatch(/exceeds the remaining/)
    expect(validateCaps([activity({ quantityDone: 5, remaining: 100 })])).toBeNull()
  })
})

describe('validateForSubmit (activity-structured)', () => {
  it('requires at least one activity with quantityDone > 0', () => {
    expect(validateForSubmit([activity({ quantityDone: 0 })])).toMatch(/at least one activity/)
    expect(validateForSubmit([])).toMatch(/at least one activity/)
  })
  it('blocks manpower headcount < 1 and hours <= 0', () => {
    expect(
      validateForSubmit([activity({ manpower: [{ categoryId: 'c', headcount: 0, hours: 8 }] })]),
    ).toMatch(/headcount/)
    expect(
      validateForSubmit([activity({ manpower: [{ categoryId: 'c', headcount: 3, hours: 0 }] })]),
    ).toMatch(/hours/)
  })
  it('blocks material quantity <= 0', () => {
    expect(
      validateForSubmit([activity({ materials: [{ materialId: 'm', quantity: 0 }] })]),
    ).toMatch(/quantity/)
  })
  it('enforces the cap on submit', () => {
    expect(validateForSubmit([activity({ quantityDone: 150, remaining: 100 })])).toMatch(/exceeds the remaining/)
  })
  it('allows a valid activity with no manpower/materials (both optional)', () => {
    expect(validateForSubmit([activity({ quantityDone: 10, remaining: 100 })])).toBeNull()
  })
})

describe('cumulativePercent', () => {
  it('earned/boq × 100, capped at 100, zero-guarded', () => {
    expect(cumulativePercent(250, 500)).toBe(50)
    expect(cumulativePercent(600, 500)).toBe(100)
    expect(cumulativePercent(0, 0)).toBe(0)
    expect(cumulativePercent(5, 0)).toBe(0)
  })
})

describe('totals', () => {
  it('computeManpowerTotals sums workers and man-hours', () => {
    expect(computeManpowerTotals([{ headcount: 10, hours: 8 }, { headcount: 3, hours: 8 }])).toEqual({
      workers: 13,
      manHours: 104,
    })
  })
  it('computeReportTotals sums manpower across all activities', () => {
    const totals = computeReportTotals([
      { manpower: [{ headcount: 10, hours: 8 }] },
      { manpower: [{ headcount: 3, hours: 8 }, { headcount: 30, hours: 8 }] },
    ])
    expect(totals).toEqual({ workers: 43, manHours: 344 })
  })
})
