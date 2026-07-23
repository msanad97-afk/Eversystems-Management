import type { ForecastRow } from '@/lib/cash'

/**
 * Running-balance line for the next N months. Themed SVG following the SCurveChart pattern
 * (no chart dependency), one shared BHD axis. A zero line is drawn and the segment below it
 * uses the danger colour, so the month cash goes negative reads at a glance — the call-out
 * above the chart names it explicitly (§7.2).
 */

const LINE = '#2a78d6'
const NEG = '#c0362c'
const GRID = '#E1E0D9'
const AXIS = '#898781'
const ZERO = '#c0362c'

function niceStep(range: number): number {
  if (range <= 0) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(range)))
  for (const s of [1, 2, 2.5, 5, 10]) if (s * pow >= range / 4) return s * pow
  return 10 * pow
}
function monthLabel(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' })
}
const bhd = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })

export function RunningCashChart({ months }: { months: ForecastRow[] }) {
  if (months.length === 0) {
    return <div className="rounded-lg border border-dashed border-border-strong bg-surface p-8 text-center text-sm text-fg-subtle">No forecast data.</div>
  }

  const values = months.map((m) => m.runningBalance)
  const rawMax = Math.max(...values, 0)
  const rawMin = Math.min(...values, 0)
  const step = niceStep(rawMax - rawMin || 1)
  const yMax = Math.ceil(rawMax / step) * step
  const yMin = Math.floor(rawMin / step) * step || 0
  const span = yMax - yMin || 1

  const PLOT_H = 200, PAD_TOP = 12, PAD_BOTTOM = 26, PAD_LEFT = 64
  const COL = Math.max(48, Math.min(90, 520 / Math.max(months.length, 1)))
  const width = PAD_LEFT + months.length * COL + 16
  const height = PAD_TOP + PLOT_H + PAD_BOTTOM

  const x = (i: number) => PAD_LEFT + i * COL + COL / 2
  const y = (v: number) => PAD_TOP + PLOT_H - ((v - yMin) / span) * PLOT_H
  const ticks: number[] = []
  for (let t = yMin; t <= yMax + 0.5; t += step) ticks.push(t)

  const pts = months.map((m, i) => ({ x: x(i), y: y(m.runningBalance), v: m.runningBalance, month: m.month }))
  const path = pts.map((p) => `${p.x},${p.y}`).join(' ')

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="w-full overflow-x-auto">
        <svg width={width} height={height} role="img" aria-label="Projected running cash balance by month" className="min-w-full">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD_LEFT} x2={width} y1={y(t)} y2={y(t)} stroke={t === 0 ? ZERO : GRID} strokeWidth={t === 0 ? 1.5 : 1} strokeDasharray={t === 0 ? '4 3' : undefined} />
              <text x={PAD_LEFT - 6} y={y(t) + 3} textAnchor="end" fontSize={9} fill={AXIS}>{bhd(t)}</text>
            </g>
          ))}

          <polyline points={path} fill="none" stroke={LINE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

          {pts.map((p) => (
            <g key={p.month}>
              <circle cx={p.x} cy={p.y} r={3.5} fill={p.v < 0 ? NEG : LINE} />
              <circle cx={p.x} cy={p.y} r={11} fill="transparent">
                <title>{`${monthLabel(p.month)} · running balance: BHD ${bhd(p.v)}`}</title>
              </circle>
            </g>
          ))}

          {months.map((m, i) => (
            <text key={m.month} x={x(i)} y={height - 8} textAnchor="middle" fontSize={8} fill={AXIS}>{monthLabel(m.month)}</text>
          ))}
        </svg>
      </div>
      <p className="mt-2 text-xs text-fg-subtle">Projected cash balance carried month to month (cleared balance + cumulative net). The dashed line is zero.</p>
    </div>
  )
}
