'use client'

import { useState } from 'react'
import { ProgressBar } from '@/components/admin/ProgressBar'
import type { ProjectOverview } from '@/lib/projectOverview.server'

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

/**
 * Project performance + physical-progress breakdown (ADMIN). One money block at project level; the
 * asset → activity tree below it is progress ONLY. Collapsible, since the page is already busy.
 */
export function ProjectOverviewPanel({ overview }: { overview: ProjectOverview }) {
  const [open, setOpen] = useState(true)
  const { project, assets } = overview

  return (
    <section className="rounded-lg border border-border bg-surface-subtle">
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

          {/* Asset → activity physical progress (no money below project level) */}
          {assets.length === 0 ? (
            <p className="text-sm text-fg-subtle">No active assets.</p>
          ) : (
            assets.map((asset, ai) => (
              <div key={ai} className="rounded-lg border border-border bg-surface p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-medium text-fg">{asset.name}{asset.ref ? <span className="ml-2 text-xs font-normal text-fg-subtle">{asset.ref}</span> : null}</p>
                  <span className="text-sm font-medium tabular-nums text-fg-muted">{pct1(asset.physicalPercent)}</span>
                </div>
                <ProgressBar percent={asset.physicalPercent} className="mt-1" />

                {asset.activities.length === 0 ? (
                  <p className="mt-2 text-xs text-fg-subtle">No active activities.</p>
                ) : (
                  <>
                    {/* Desktop table */}
                    <div className="mt-3 hidden overflow-x-auto md:block">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-fg-subtle">
                            <th className="py-1 pr-3 font-semibold">Activity</th>
                            <th className="py-1 px-3 text-right font-semibold">BOQ</th>
                            <th className="py-1 pl-3 font-semibold">% complete</th>
                          </tr>
                        </thead>
                        <tbody>
                          {asset.activities.map((act, xi) => (
                            <tr key={xi} className="border-b border-border last:border-0">
                              <td className="py-1 pr-3 text-fg">{act.ref ? `${act.ref} · ` : ''}{act.name}</td>
                              <td className="py-1 px-3 text-right tabular-nums text-fg-muted">{act.boqQuantity} {act.unit ?? ''}</td>
                              <td className="py-1 pl-3">
                                <div className="flex items-center gap-2">
                                  <ProgressBar percent={act.physicalPercent} className="w-32" />
                                  <span className="w-12 text-right tabular-nums text-xs text-fg-muted">{pct1(act.physicalPercent)}</span>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile: stacked cards (inventory pattern) */}
                    <div className="mt-3 space-y-2 md:hidden">
                      {asset.activities.map((act, xi) => (
                        <div key={xi} className="rounded-md border border-border p-2">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-sm text-fg">{act.ref ? `${act.ref} · ` : ''}{act.name}</span>
                            <span className="text-xs font-medium tabular-nums text-fg-muted">{pct1(act.physicalPercent)}</span>
                          </div>
                          <p className="text-xs text-fg-subtle">BOQ {act.boqQuantity} {act.unit ?? ''}</p>
                          <ProgressBar percent={act.physicalPercent} className="mt-1" />
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </section>
  )
}
