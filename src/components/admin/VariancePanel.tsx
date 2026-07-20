import type { ProjectBudgetVsActual, ActivityBVA } from '@/lib/actuals.server'
import type { Light, VarianceLine } from '@/lib/actuals'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'

const DOT: Record<Light, string> = {
  green: 'bg-success',
  amber: 'bg-warning',
  red: 'bg-danger',
  none: 'bg-fg-subtle/40',
}
const TEXT: Record<Light, string> = {
  green: 'text-success',
  amber: 'text-warning',
  red: 'text-danger',
  none: 'text-fg-subtle',
}

function num(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 })
}
function bhd(n: number): string {
  return `BHD ${n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`
}
function LightDot({ light }: { light: Light }) {
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${DOT[light]}`} aria-hidden />
}

function VarianceTable({ title, lines }: { title: string; lines: VarianceLine[] }) {
  if (lines.length === 0) return null
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle">{title}</p>
      <Table>
        <THead>
          <TR><TH>Item</TH><TH className="text-right">Budget</TH><TH className="text-right">Actual</TH><TH className="text-right">Var</TH><TH className="text-right">%</TH><TH></TH></TR>
        </THead>
        <TBody>
          {lines.map((l) => (
            <TR key={l.key}>
              <TD>{l.name}{l.unit ? ` (${l.unit})` : ''}</TD>
              <TD className="text-right tabular-nums">{num(l.budget)}</TD>
              <TD className="text-right tabular-nums">{num(l.actual)}</TD>
              <TD className={`text-right tabular-nums ${l.variance < 0 ? 'text-danger' : 'text-fg'}`}>{num(l.variance)}</TD>
              <TD className={`text-right tabular-nums ${TEXT[l.light]}`}>{l.consumedPct == null ? '—' : `${l.consumedPct}%`}</TD>
              <TD><LightDot light={l.light} /></TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  )
}

function ActivityCard({ a }: { a: ActivityBVA }) {
  const hasMeasured = a.measured.labour.length > 0 || a.measured.materials.length > 0
  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <LightDot light={a.worstLight} />
        <span className="text-sm font-medium text-fg">{a.ref ? `${a.ref} · ` : ''}{a.name}</span>
        {a.type === 'MEASURED' && <span className="text-xs text-fg-subtle">{a.physicalPercent}% complete</span>}
        {a.lumpsumBudgetBhd > 0 && (
          <span className="ml-auto text-xs text-fg-muted">Earned {bhd(a.lumpsumEarnedBhd)} / {bhd(a.lumpsumBudgetBhd)} ({a.lumpsumPercent}%)</span>
        )}
      </div>
      <div className="space-y-3 p-3">
        {hasMeasured ? (
          <>
            <VarianceTable title="Labour (man-hours)" lines={a.measured.labour} />
            <VarianceTable title="Materials" lines={a.measured.materials} />
          </>
        ) : a.lumpsumBudgetBhd > 0 ? (
          <p className="text-sm text-fg-subtle">Lumpsum line — earned value shown above (actual cost arrives in Phase 6).</p>
        ) : (
          <p className="text-sm text-fg-subtle">No budget to compare.</p>
        )}
      </div>
    </div>
  )
}

/**
 * Budget-vs-actual (Phase C2). Measured lines show budget/actual/variance with a traffic
 * light (green <90% consumed, amber 90–100%, red over); lumpsum shows earned value (% × BHD).
 * Actuals are APPROVED-only.
 */
export function VariancePanel({ data }: { data: ProjectBudgetVsActual }) {
  const empty = data.assets.every((as) => as.activities.length === 0)
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Budget vs actual</h2>
        <p className="text-xs text-fg-subtle">Actuals from approved reports. Light: green &lt;90% of budget used · amber 90–100% · red over.</p>
      </div>

      {empty ? (
        <EmptyState title="Nothing to compare yet" description="Place budgeted activities and approve reports to see variance." />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card label="Physical % complete" value={`${data.totals.physicalPercent}%`} />
            <Card label="Lumpsum earned" value={bhd(data.totals.lumpsumEarnedBhd)} sub={`of ${bhd(data.totals.lumpsumBudgetBhd)}`} />
            <div className="rounded-lg border border-border bg-surface p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Overall status</p>
              <p className="mt-1 flex items-center gap-2 text-lg font-semibold text-fg">
                <LightDot light={data.totals.worstLight} />
                <span className={TEXT[data.totals.worstLight]}>
                  {data.totals.worstLight === 'red' ? 'Over budget' : data.totals.worstLight === 'amber' ? 'Near budget' : data.totals.worstLight === 'green' ? 'Under budget' : '—'}
                </span>
              </p>
            </div>
          </div>

          <VarianceTable title="Project labour (man-hours)" lines={data.totals.labour} />
          <VarianceTable title="Project materials" lines={data.totals.materials} />

          <div className="space-y-3">
            {data.assets.map((asset) => (
              <div key={asset.assetId} className="space-y-2">
                <h3 className="text-sm font-semibold text-fg">{asset.assetName}</h3>
                {asset.activities.map((a) => <ActivityCard key={a.activityId} a={a} />)}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-fg">{value}</p>
      {sub && <p className="text-xs text-fg-subtle">{sub}</p>}
    </div>
  )
}
