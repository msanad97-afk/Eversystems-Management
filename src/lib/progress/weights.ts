/**
 * Sub-activity progress weighting (pure, UI-free). ONE rule, used by every caller — validation
 * (the catalogue + placed editors), progress aggregation (dashboard/actuals) and any live UI
 * preview. Do not reimplement it anywhere.
 *
 * Given the active sub-activities on ONE activity (measured AND lumpsum — a lumpsum carries weight
 * like anything else):
 *   - each entered weight must be > 0 and <= 100;
 *   - if ANY sub is unweighted, the entered weights must sum to < 100 and the remainder is split
 *     equally across the unweighted ones;
 *   - if ALL are weighted, they must sum to exactly 100 (tolerance 0.001);
 *   - if NONE are weighted, every sub takes 100/n;
 *   - a sum > 100 is rejected in every case.
 */

const TOL = 0.001
const r3 = (n: number) => Math.round(n * 1000) / 1000

export interface WeightInput {
  id: string
  weightPct: number | null // entered weight; null = unweighted
}
export interface ResolvedWeight {
  id: string
  weightPct: number // resolved percentage (the set sums to ~100)
  entered: boolean // whether the admin typed this one
}
export type WeightResolution = { ok: true; resolved: ResolvedWeight[] } | { ok: false; error: string }

export function resolveSubActivityWeights(subs: WeightInput[]): WeightResolution {
  const n = subs.length
  if (n === 0) return { ok: true, resolved: [] }

  for (const s of subs) {
    if (s.weightPct == null) continue
    if (!(s.weightPct > 0)) return { ok: false, error: 'A sub-activity weight must be greater than 0.' }
    if (s.weightPct > 100 + TOL) return { ok: false, error: 'A sub-activity weight cannot exceed 100.' }
  }

  const entered = subs.filter((s) => s.weightPct != null) as (WeightInput & { weightPct: number })[]
  const blanks = subs.filter((s) => s.weightPct == null)
  const sumEntered = entered.reduce((a, s) => a + s.weightPct, 0)

  if (sumEntered > 100 + TOL) {
    return { ok: false, error: `Weights total ${r3(sumEntered)}, which is more than 100. Reduce them.` }
  }

  // NONE weighted → equal split.
  if (entered.length === 0) {
    const each = r3(100 / n)
    return { ok: true, resolved: subs.map((s) => ({ id: s.id, weightPct: each, entered: false })) }
  }

  // ALL weighted → must total exactly 100.
  if (blanks.length === 0) {
    if (Math.abs(sumEntered - 100) > TOL) {
      return { ok: false, error: `Weights total ${r3(sumEntered)} but must total exactly 100.` }
    }
    return { ok: true, resolved: subs.map((s) => ({ id: s.id, weightPct: r3(s.weightPct as number), entered: true })) }
  }

  // SOME weighted, SOME blank → entered must leave a positive remainder for the blanks to share.
  const remainder = 100 - sumEntered
  if (remainder <= TOL) {
    const nb = blanks.length
    return {
      ok: false,
      error: `Weights total ${r3(sumEntered)} but ${nb} sub-activit${nb === 1 ? 'y is' : 'ies are'} unweighted. Either weight them or reduce the others.`,
    }
  }
  const each = r3(remainder / blanks.length)
  return {
    ok: true,
    resolved: subs.map((s) =>
      s.weightPct != null ? { id: s.id, weightPct: r3(s.weightPct), entered: true } : { id: s.id, weightPct: each, entered: false },
    ),
  }
}

/** Resolved weights as a Map, falling back to an equal split when the set is invalid — for READ/
 *  display paths that must render something (the editors' validation is what blocks a bad save). */
export function resolvedWeightMap(subs: WeightInput[]): Map<string, number> {
  const res = resolveSubActivityWeights(subs)
  if (res.ok) return new Map(res.resolved.map((r) => [r.id, r.weightPct]))
  const each = subs.length > 0 ? r3(100 / subs.length) : 0
  return new Map(subs.map((s) => [s.id, each]))
}

/**
 * Weighted physical % for one activity over its MEASURED sub-activities. Weights are resolved over
 * ALL the active subs passed (measured + lumpsum both carry weight), then the measured subs'
 * percentages are combined in proportion to their resolved weights — normalised by the measured
 * weight total, so physical % stays a measured-only figure (a lumpsum's completion is tracked as
 * earned value, not folded into physical progress). All-unweighted reduces to the old plain mean.
 */
export function weightedActivityPercent(
  subs: { id: string; type: 'MEASURED' | 'LUMPSUM'; weightPct: number | null }[],
  measuredPct: Map<string, number>,
): number {
  const weights = resolvedWeightMap(subs)
  const measured = subs.filter((s) => s.type === 'MEASURED')
  if (measured.length === 0) return 0
  const sumW = measured.reduce((a, s) => a + (weights.get(s.id) ?? 0), 0)
  if (sumW <= 0) return r3(measured.reduce((a, s) => a + (measuredPct.get(s.id) ?? 0), 0) / measured.length)
  const num = measured.reduce((a, s) => a + (measuredPct.get(s.id) ?? 0) * (weights.get(s.id) ?? 0), 0)
  return r3(num / sumW)
}
