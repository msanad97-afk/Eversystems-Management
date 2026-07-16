import type { ManHoursDayRow } from '@/lib/dashboard'

/**
 * Man-hours per day, stacked by trade. Custom themed SVG (no chart dependency).
 * Palette is the data-viz reference categorical set (validated; light surface).
 * Trades beyond the top 6 (by total man-hours in range) fold into "Other" so the
 * colour set stays legible; identity is carried by a legend + per-segment hover,
 * never colour alone.
 */

const PALETTE = ['#2a78d6', '#008300', '#e87ba4', '#eda100', '#1baf7a', '#eb6834']
const OTHER_COLOR = '#898781'
const TOP_N = 6

function niceMax(max: number): number {
  if (max <= 0) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(max)))
  const steps = [1, 2, 2.5, 5, 10]
  for (const s of steps) {
    const candidate = s * pow
    if (candidate >= max) return candidate
  }
  return 10 * pow
}

function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

export function ManpowerChart({ rows, max }: { rows: ManHoursDayRow[]; max: number }) {
  // Rank categories by total across the range; keep top N, fold the rest into "Other".
  const totals = new Map<string, number>()
  for (const r of rows) for (const [c, v] of Object.entries(r.byCategory)) totals.set(c, (totals.get(c) ?? 0) + v)
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)
  const top = ranked.slice(0, TOP_N)
  const hasOther = ranked.length > TOP_N
  const legend = [
    ...top.map((name, i) => ({ name, color: PALETTE[i]! })),
    ...(hasOther ? [{ name: 'Other', color: OTHER_COLOR }] : []),
  ]

  if (max <= 0) {
    return (
      <div className="rounded-lg border border-dashed border-border-strong bg-surface p-8 text-center text-sm text-fg-subtle">
        No man-hours in this range.
      </div>
    )
  }

  const yMax = niceMax(max)
  const PLOT_H = 200
  const PAD_TOP = 8
  const PAD_BOTTOM = 22
  const PAD_LEFT = 40
  const COL = 34
  const BAR = 22
  const width = PAD_LEFT + rows.length * COL + 8
  const height = PAD_TOP + PLOT_H + PAD_BOTTOM
  const y = (v: number) => PAD_TOP + PLOT_H - (v / yMax) * PLOT_H
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(yMax * f))

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="w-full overflow-x-auto">
        <svg width={width} height={height} role="img" aria-label="Man-hours per day by trade" className="min-w-full">
          {/* Gridlines + y ticks */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD_LEFT} x2={width} y1={y(t)} y2={y(t)} stroke="#E1E0D9" strokeWidth={1} />
              <text x={PAD_LEFT - 6} y={y(t) + 3} textAnchor="end" fontSize={9} fill="#898781">
                {t}
              </text>
            </g>
          ))}

          {/* Bars */}
          {rows.map((r, i) => {
            const x = PAD_LEFT + i * COL + (COL - BAR) / 2
            let cursor = 0 // running total from bottom
            const segs = legend
              .map((l) => {
                const val =
                  l.name === 'Other'
                    ? Object.entries(r.byCategory).filter(([c]) => !top.includes(c)).reduce((s, [, v]) => s + v, 0)
                    : (r.byCategory[l.name] ?? 0)
                return { name: l.name, color: l.color, val }
              })
              .filter((s) => s.val > 0)
            return (
              <g key={r.date}>
                {segs.map((s, si) => {
                  const yTop = y(cursor + s.val)
                  const h = (s.val / yMax) * PLOT_H
                  cursor += s.val
                  const isTop = si === segs.length - 1
                  // 2px surface gap between stacked segments (except the topmost).
                  const gap = isTop ? 0 : 2
                  return (
                    <rect
                      key={s.name}
                      x={x}
                      y={yTop}
                      width={BAR}
                      height={Math.max(0, h - gap)}
                      rx={isTop ? 3 : 0}
                      fill={s.color}
                    >
                      <title>{`${formatDay(r.date)} · ${s.name}: ${Math.round(s.val)} man-hrs`}</title>
                    </rect>
                  )
                })}
                <text x={x + BAR / 2} y={height - 6} textAnchor="middle" fontSize={8} fill="#898781">
                  {formatDay(r.date)}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      {/* Legend (identity is never colour-alone) */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {legend.map((l) => (
          <span key={l.name} className="flex items-center gap-1.5 text-xs text-fg-muted">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: l.color }} />
            {l.name}
          </span>
        ))}
      </div>
    </div>
  )
}
