import { describe, it, expect } from 'vitest'
import { resolveSubActivityWeights, weightedActivityPercent } from '@/lib/progress/weights'

const w = (id: string, weightPct: number | null) => ({ id, weightPct })

describe('resolveSubActivityWeights — the shared rule', () => {
  it('no weights → equal split; three subs each resolve to 33.333', () => {
    const res = resolveSubActivityWeights([w('a', null), w('b', null), w('c', null)])
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.resolved.map((r) => r.weightPct)).toEqual([33.333, 33.333, 33.333])
    expect(res.resolved.every((r) => r.entered === false)).toBe(true)
  })

  it('all weighted summing to 100 → resolves to those weights', () => {
    const res = resolveSubActivityWeights([w('a', 50), w('b', 30), w('c', 20)])
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.resolved.map((r) => r.weightPct)).toEqual([50, 30, 20])
    expect(res.resolved.every((r) => r.entered)).toBe(true)
  })

  it('partial: 20/30/25 entered with three blanks → blanks resolve to 8.333 each', () => {
    const res = resolveSubActivityWeights([w('a', 20), w('b', 30), w('c', 25), w('d', null), w('e', null), w('f', null)])
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const map = new Map(res.resolved.map((r) => [r.id, r.weightPct]))
    expect(map.get('a')).toBe(20)
    expect(map.get('d')).toBe(8.333)
    expect(map.get('e')).toBe(8.333)
    expect(map.get('f')).toBe(8.333)
  })

  it('entered weights summing to exactly 100 WITH blanks present → rejected, error names the remedy', () => {
    const res = resolveSubActivityWeights([w('a', 60), w('b', 40), w('c', null), w('d', null), w('e', null)])
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toMatch(/unweighted/)
    expect(res.error).toMatch(/Either weight them or reduce the others/)
    expect(res.error).toContain('3') // names how many are unweighted
  })

  it('sum > 100 → rejected', () => {
    const res = resolveSubActivityWeights([w('a', 60), w('b', 50)])
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toMatch(/more than 100/)
  })

  it('all weighted but summing to < 100 (no blanks) → rejected', () => {
    const res = resolveSubActivityWeights([w('a', 60), w('b', 30)])
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toMatch(/must total exactly 100/)
  })

  it('a weight <= 0 → rejected', () => {
    expect(resolveSubActivityWeights([w('a', 0), w('b', 100)]).ok).toBe(false)
    expect(resolveSubActivityWeights([w('a', -5), w('b', 100)]).ok).toBe(false)
  })

  it('lumpsum subs participate in the weighting (their weight counts toward the sum rule)', () => {
    // A measured sub (60) + a lumpsum sub (60): the lumpsum's weight is counted, so the sum is 120.
    const res = resolveSubActivityWeights([w('measured', 60), w('lumpsum', 60)])
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toMatch(/more than 100/)
    // And a lumpsum blank takes an equal remainder share, like any other sub.
    const ok = resolveSubActivityWeights([w('measured', 80), w('lumpsum', null)])
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(new Map(ok.resolved.map((r) => [r.id, r.weightPct])).get('lumpsum')).toBe(20)
  })
})

describe('weightedActivityPercent — measured physical %', () => {
  const measured = (id: string, type: 'MEASURED' | 'LUMPSUM', weightPct: number | null) => ({ id, type, weightPct })

  it('all-unweighted reduces to the plain mean (no regression for existing null weights)', () => {
    const subs = [measured('a', 'MEASURED', null), measured('b', 'MEASURED', null), measured('c', 'MEASURED', null)]
    const pct = new Map([['a', 100], ['b', 50], ['c', 0]])
    expect(weightedActivityPercent(subs, pct)).toBe(50) // (100+50+0)/3
  })

  it('weights shift the activity percent (70/30 over two measured subs)', () => {
    const subs = [measured('a', 'MEASURED', 70), measured('b', 'MEASURED', 30)]
    const pct = new Map([['a', 100], ['b', 0]])
    expect(weightedActivityPercent(subs, pct)).toBe(70) // vs 50 unweighted
  })
})
