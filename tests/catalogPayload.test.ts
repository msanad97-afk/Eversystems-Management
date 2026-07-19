import { describe, it, expect } from 'vitest'
import { parseCatalogActivity } from '@/lib/catalog/payload'
import { IMPLICIT_SUBACTIVITY_NAME } from '@/lib/catalog/constants'

describe('parseCatalogActivity', () => {
  it('wraps a flat measured activity’s rates in a single hidden implicit sub-activity', () => {
    const p = parseCatalogActivity({
      name: 'Blockwork',
      type: 'MEASURED',
      unit: 'm2',
      activityRates: { manpowerRates: [{ laborCategoryId: 'mason', hoursPerUnit: 0.5 }], materialRates: [{ materialId: 'block', qtyPerUnit: 12.5 }] },
    })
    expect('error' in p).toBe(false)
    if ('error' in p) return
    expect(p.subActivities).toHaveLength(1)
    expect(p.subActivities[0]!.isImplicit).toBe(true)
    expect(p.subActivities[0]!.name).toBe(IMPLICIT_SUBACTIVITY_NAME)
    expect(p.subActivities[0]!.manpowerRates[0]).toEqual({ laborCategoryId: 'mason', hoursPerUnit: 0.5 })
  })

  it('keeps named sub-activities visible (not implicit)', () => {
    const p = parseCatalogActivity({
      name: 'EIFS',
      type: 'MEASURED',
      unit: 'm2',
      subActivities: [
        { name: 'Base coat', type: 'MEASURED', manpowerRates: [{ laborCategoryId: 'mason', hoursPerUnit: 0.3 }], materialRates: [] },
        { name: 'Scaffolding', type: 'LUMPSUM', lumpsumBhd: 2500 },
      ],
    })
    expect('error' in p).toBe(false)
    if ('error' in p) return
    expect(p.subActivities).toHaveLength(2)
    expect(p.subActivities.every((s) => !s.isImplicit)).toBe(true)
    expect(p.subActivities[1]!.type).toBe('LUMPSUM')
    expect(p.subActivities[1]!.lumpsumBhd).toBe(2500)
  })

  it('allows a bare measured activity with no rates and no sub-activities', () => {
    const p = parseCatalogActivity({ name: 'Excavation', type: 'MEASURED', unit: 'm3' })
    expect('error' in p).toBe(false)
    if ('error' in p) return
    expect(p.subActivities).toHaveLength(0)
  })

  it('rejects the reserved implicit name for a real sub-activity', () => {
    const p = parseCatalogActivity({
      name: 'X', type: 'MEASURED', unit: 'm2',
      subActivities: [{ name: IMPLICIT_SUBACTIVITY_NAME, type: 'MEASURED', manpowerRates: [], materialRates: [] }],
    })
    expect('error' in p).toBe(true)
  })

  it('requires a positive BHD for a lumpsum activity', () => {
    expect('error' in parseCatalogActivity({ name: 'Mob', type: 'LUMPSUM' })).toBe(true)
    expect('error' in parseCatalogActivity({ name: 'Mob', type: 'LUMPSUM', lumpsumBhd: 0 })).toBe(true)
    const ok = parseCatalogActivity({ name: 'Mob', type: 'LUMPSUM', lumpsumBhd: 1200.5 })
    expect('error' in ok).toBe(false)
  })

  it('requires a unit for a measured activity', () => {
    expect('error' in parseCatalogActivity({ name: 'X', type: 'MEASURED' })).toBe(true)
  })
})
