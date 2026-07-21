import type { SeriesPoint } from '@/lib/evm.server'

/**
 * PV / EV / AC cumulative S-curve. Custom themed SVG following the ManpowerChart pattern
 * (no chart dependency). One shared BHD axis — never a dual axis. Identity is carried by a
 * legend plus per-point hover, never colour alone. When the project has no baseline the PV
 * line is omitted entirely rather than drawn at zero, which would read as "planned nothing".
 */

const COLORS = { pv: '#2a78d6', ev: '#008300', ac: '#eb6834' } as const
const GRID = '#E1E0D9'
const AXIS = '#898781'
const TODAY = '#A8A6A0'

function niceMax(max: number): number {
  if (max <= 0) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(max)))
  for (const s of [1, 2, 2.5, 5, 10]) {
    const candidate = s * pow
    if (candidate >= max) return candidate
  }
  return 10 * pow
}
function monthLabel(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' })
}
const bhd = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })

export function SCurveChart({ series, asOf, hasBaseline }: { series: SeriesPoint[]; asOf: string; hasBaseline: boolean }) {
  if (series.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border-strong bg-surface p-8 text-center text-sm text-fg-subtle">
        No approved progress yet — the curve appears once work is approved.
      </div>
    )
  }

  const maxVal = Math.max(
    ...series.map((s) => Math.max(s.pvCum ?? 0, s.evCum, s.acCum)),
    1,
  )
  const yMax = niceMax(maxVal)

  const PLOT_H = 220
  const PAD_TOP = 10
  const PAD_BOTTOM = 26
  const PAD_LEFT = 56
  const COL = Math.max(44, Math.min(90, 520 / Math.max(series.length, 1)))
  const width = PAD_LEFT + series.length * COL + 16
  const height = PAD_TOP + PLOT_H + PAD_BOTTOM

  const x = (i: number) => PAD_LEFT + i * COL + COL / 2
  const y = (v: number) => PAD_TOP + PLOT_H - (v / yMax) * PLOT_H
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => yMax * f)

  const line = (get: (s: SeriesPoint) => number | null) =>
    series
      .map((s, i) => ({ i, v: get(s) }))
      .filter((p): p is { i: number; v: number } => p.v !== null)
      .map((p) => `${x(p.i)},${y(p.v)}`)
      .join(' ')

  const asOfMonth = `${asOf.slice(0, 7)}-01`
  const todayIdx = series.findIndex((s) => s.month === asOfMonth)

  const lines: { key: 'pv' | 'ev' | 'ac'; label: string; get: (s: SeriesPoint) => number | null }[] = [
    ...(hasBaseline ? [{ key: 'pv' as const, label: 'Planned (PV)', get: (s: SeriesPoint) => s.pvCum }] : []),
    { key: 'ev', label: 'Earned (EV)', get: (s: SeriesPoint) => s.evCum },
    { key: 'ac', label: 'Actual (AC)', get: (s: SeriesPoint) => s.acCum },
  ]

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="w-full overflow-x-auto">
        <svg width={width} height={height} role="img" aria-label="Cumulative planned, earned and actual value by month" className="min-w-full">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD_LEFT} x2={width} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
              <text x={PAD_LEFT - 6} y={y(t) + 3} textAnchor="end" fontSize={9} fill={AXIS}>{bhd(t)}</text>
            </g>
          ))}

          {todayIdx >= 0 && (
            <g>
              <line x1={x(todayIdx)} x2={x(todayIdx)} y1={PAD_TOP} y2={PAD_TOP + PLOT_H} stroke={TODAY} strokeWidth={1} strokeDasharray="3 3" />
              <text x={x(todayIdx)} y={PAD_TOP + 9} textAnchor="middle" fontSize={8} fill={AXIS}>today</text>
            </g>
          )}

          {lines.map((l) => (
            <polyline key={l.key} points={line(l.get)} fill="none" stroke={COLORS[l.key]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}

          {/* Markers carry the hover tooltip; the invisible circle widens the hit target. */}
          {lines.map((l) =>
            series.map((s, i) => {
              const v = l.get(s)
              if (v === null) return null
              return (
                <g key={`${l.key}-${s.month}`}>
                  <circle cx={x(i)} cy={y(v)} r={3.5} fill={COLORS[l.key]} />
                  <circle cx={x(i)} cy={y(v)} r={10} fill="transparent">
                    <title>{`${monthLabel(s.month)} · ${l.label}: BHD ${bhd(v)}`}</title>
                  </circle>
                </g>
              )
            }),
          )}

          {series.map((s, i) => (
            <text key={s.month} x={x(i)} y={height - 8} textAnchor="middle" fontSize={8} fill={AXIS}>
              {monthLabel(s.month)}
            </text>
          ))}
        </svg>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {lines.map((l) => (
          <span key={l.key} className="flex items-center gap-1.5 text-xs text-fg-muted">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: COLORS[l.key] }} />
            {l.label}
          </span>
        ))}
        {!hasBaseline && <span className="text-xs text-fg-subtle">No baseline set — planned line hidden.</span>}
      </div>
    </div>
  )
}
