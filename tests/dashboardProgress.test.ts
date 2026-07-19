import { describe, it, expect } from 'vitest'
import { aggregateProgress, type ProgressRow } from '@/lib/dashboard'

const row = (over: Partial<ProgressRow>): ProgressRow => ({
  projectId: 'p1', projectCode: 'PRJ-2026-001', projectName: 'Alpha',
  assetId: 'a1', assetName: 'Tower A',
  activityId: 'act', ref: null, name: 'Activity', unit: 'm2', boqQuantity: 100, earned: 0,
  ...over,
})

describe('aggregateProgress', () => {
  const rows: ProgressRow[] = [
    row({ assetId: 'a1', assetName: 'Tower A', activityId: 'act1', name: 'Blockwork', unit: 'm2', boqQuantity: 100, earned: 30 }),
    row({ assetId: 'a1', assetName: 'Tower A', activityId: 'act2', name: 'Concrete', unit: 'm3', boqQuantity: 50, earned: 50 }),
    row({ assetId: 'a2', assetName: 'External', activityId: 'act3', name: 'Excavation', unit: 'm3', boqQuantity: 800, earned: 0 }),
    row({ projectId: 'p2', projectCode: 'PRJ-2026-002', projectName: 'Beta', assetId: 'b1', assetName: 'Block B', activityId: 'act4', name: 'Kerbs', unit: 'LM', boqQuantity: 10, earned: 20 }),
  ]
  const result = aggregateProgress(rows)

  it('groups into projects → assets → activities', () => {
    expect(result.map((p) => p.projectCode)).toEqual(['PRJ-2026-001', 'PRJ-2026-002'])
    const p1 = result[0]!
    expect(p1.activityCount).toBe(3)
    expect(p1.assets.map((a) => a.assetName)).toEqual(['Tower A', 'External'])
  })

  it('computes per-activity % (capped 100) and remaining (boq − earned, floored at 0)', () => {
    const p1 = result[0]!
    const [act1, act2] = p1.assets[0]!.activities
    expect(act1!.percent).toBe(30) // 30/100
    expect(act1!.remaining).toBe(70)
    expect(act2!.percent).toBe(100) // 50/50
    expect(act2!.remaining).toBe(0)
    expect(p1.assets[1]!.activities[0]!.percent).toBe(0) // 0/800
    const p2 = result[1]!
    expect(p2.assets[0]!.activities[0]!.percent).toBe(100) // 20/10 capped at 100
    expect(p2.assets[0]!.activities[0]!.remaining).toBe(0)
  })

  it('project physical % = unweighted mean of its activity %s', () => {
    // Alpha: (30 + 100 + 0) / 3 = 43.333…
    expect(result[0]!.physicalPercent).toBeCloseTo(43.3333, 3)
    // Beta: single activity capped at 100
    expect(result[1]!.physicalPercent).toBe(100)
  })

  it('returns empty for no rows', () => {
    expect(aggregateProgress([])).toEqual([])
  })
})
