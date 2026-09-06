'use client'

import { useState } from 'react'
import { ProgressBar } from '@/components/admin/ProgressBar'
import type { ProjectOverview, ActivityMatrix } from '@/lib/projectOverview.server'

const bhd0 = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })
const pct1 = (n: number) => `${Math.round(n * 10) / 10}%`
const idx = (v: number | null) => (v == null ? 'N/A' : v.toFixed(2))

/** Index colouring against 1.0, matching the EVM panels: green ≥ 1.0, amber 0.9–1.0, red < 0.9. */
function indexTone(v: number | null): string {
  if (v == null) return 'text-fg-subtle'
  if (v >= 1) return 'text-success'
  if (v >= 0.9) return 'text-warning'
  return 'text-danger'
}

function Stat({ label, value, tone, sub }: { label: string; value: string; tone?: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${tone ?? 'text-fg'}`}>{value}</p>
      {sub && <p className="text-xs text-fg-subtle">{sub}</p>}
    </div>
  )
}

/** A progress cell: "% +delta", green when it rose in the last 7 days; a dash when the sub is
 *  absent from this asset's scope (never a 0, which would read as "started but nothing done"). */
function Cell({ cell }: { cell: { percent: number; delta: number | null } | null }) {
  if (cell == null) return <td className="px-3 py-2 text-center text-fg-subtle" aria-label="not in scope">–</td>
  const rose = cell.delta != null
  return (
    <td className={`px-3 py-2 text-right tabular-nums ${rose ? 'bg-success-bg' : ''}`}>
      <span className="font-medium text-fg">{pct1(cell.percent)}</span>
      {rose && <span className="ml-1 text-xs font-semibold text-success">+{cell.delta}</span>}
    </td>
  )
}

function MatrixTable({ activity }: { activity: ActivityMatrix }) {
  const { columns, rows } = activity
  return (
    <div>
      <p className="mb-1 text-sm font-medium text-fg">
        {activity.ref ? <span className="text-xs font-normal text-fg-subtle">{activity.ref} · </span> : null}
        {activity.name}
      </p>
      <div className="w-full overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-surface-subtle">
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-fg-subtle">
              <th className="px-3 py-2 font-semibold">Asset</th>
              <th className="px-3 py-2 text-right font-semibold">BOQ</th>
              {columns.map((c) => (
                <th key={c.key} className="px-3 py-2 text-right font-semibold">{c.name}</th>
              ))}
              <th className="px-3 py-2 text-right font-semibold">Total work done %</th>
            </tr>
            {columns.length > 0 && (
              <tr className="border-b border-border text-right text-[10px] uppercase tracking-wide text-fg-subtle">
                <th className="px-3 py-1 text-left font-normal">Weight</th>
                <th className="px-3 py-1" />
                {columns.map((c) => (
                  <th key={c.key} className="px-3 py-1 font-normal tabular-nums">{pct1(c.weightPct)}</th>
                ))}
                <th className="px-3 py-1" />
              </tr>
            )}
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.assetId}>
                <td className="px-3 py-2 text-fg">
                  {r.assetName}
                  {r.assetRef ? <span className="ml-1 text-xs text-fg-subtle">{r.assetRef}</span> : null}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-fg-muted">{r.boqQuantity}{r.unit ? ` ${r.unit}` : ''}</td>
                {r.cells.map((cell, i) => <Cell key={columns[i]!.key} cell={cell} />)}
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-2">
                    <ProgressBar percent={r.totalPercent} className="w-24" />
                    <span className="w-12 text-right font-semibold tabular-nums text-fg">{pct1(r.totalPercent)}</span>
                    {r.totalDelta != null && <span className="text-xs font-semibold text-success">+{r.totalDelta}</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * Project performance + a per-activity progress MATRIX (ADMIN). One money block at project level;
 * below it, one table per active activity — assets as rows, sub-activities as columns, cumulative %
 * in the cells and the weighted physical % in the total column. Collapsible; the page is busy.
 */
export function ProjectOverviewPanel({ overview }: { overview: ProjectOverview }) {
  const [open, setOpen] = useState(true)
  const { project, matrix } = overview

  return (
    <section className="min-w-0 rounded-lg border border-border bg-surface-subtle">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 px-4 py-3" aria-expanded={open}>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Performance &amp; progress</h2>
        <span className="text-fg-subtle">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="space-y-4 px-4 pb-4">
          {/* Project money block */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <Stat label="Contract value" value={`BHD ${bhd0(project.contractValue)}`} />
            <Stat label="BAC" value={`BHD ${bhd0(project.bac)}`} sub="budget at completion" />
            <Stat label="EV" value={`BHD ${bhd0(project.ev)}`} sub="earned value" />
            <Stat label="AC" value={`BHD ${bhd0(project.ac)}`} sub="approved field cost" />
            <Stat label="CV" value={`BHD ${bhd0(project.cv)}`} tone={project.cv < 0 ? 'text-danger' : 'text-success'} sub="EV − AC" />
            <Stat label="CPI" value={idx(project.cpi)} tone={indexTone(project.cpi)} sub={project.cpi == null ? 'no cost yet' : 'cost index'} />
            <Stat label="EAC" value={`BHD ${bhd0(project.eac)}`} sub="estimate at completion" />
            <Stat label="VAC" value={`BHD ${bhd0(project.vac)}`} tone={project.vac < 0 ? 'text-danger' : 'text-success'} sub="budget − EAC" />
          </div>

          {/* The two completion figures side by side — they diverge, and the gap is informative. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-surface p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Physical % complete</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-fg">{pct1(project.physicalPercent)}</p>
              <ProgressBar percent={project.physicalPercent} className="mt-2" />
              <p className="mt-1 text-xs text-fg-subtle">weighted progress across activities</p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Value % complete</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-fg">{pct1(project.valuePercent)}</p>
              <ProgressBar percent={project.valuePercent} className="mt-2" />
              <p className="mt-1 text-xs text-fg-subtle">EV ÷ BAC (earned value)</p>
            </div>
          </div>

          {/* Per-activity progress matrix. Green cells rose in the last 7 days (with the increase). */}
          {matrix.length === 0 ? (
            <p className="text-sm text-fg-subtle">No active activities.</p>
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-fg-subtle">
                A table per activity. Cells are cumulative % complete; <span className="rounded bg-success-bg px-1 text-success">green</span> marks a rise in the last 7 days. A dash means the sub-activity is not in that asset&apos;s scope.
              </p>
              {matrix.map((activity) => <MatrixTable key={activity.key} activity={activity} />)}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
