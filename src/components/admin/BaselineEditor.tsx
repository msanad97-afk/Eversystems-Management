'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/contexts/ToastContext'
import { validateBaseline, type BaselinePoint } from '@/lib/evm'

/**
 * The baseline S-curve editor — cumulative planned % of BAC per month.
 *
 * The FINAL month is auto-pinned to 100% and not hand-editable, so "must end at 100%" can
 * never become a save-blocker; the manager only enters the intermediate cumulative values.
 * Client validation mirrors the server rules exactly (same pure `validateBaseline`), so the
 * two can't drift apart.
 */
function addMonth(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCMonth(d.getUTCMonth() + delta)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}
function thisMonth(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}
const label = (iso: string) =>
  new Date(`${iso}T00:00:00.000Z`).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' })

/** Pin the last row to 100 — the invariant the server also enforces. */
function pinFinal(rows: BaselinePoint[]): BaselinePoint[] {
  if (rows.length === 0) return rows
  return rows.map((r, i) => (i === rows.length - 1 ? { ...r, cumPlannedPct: 100 } : r))
}

export function BaselineEditor({ projectId, initial }: { projectId: string; initial: BaselinePoint[] }) {
  const router = useRouter()
  const { showToast } = useToast()
  const [rows, setRows] = useState<BaselinePoint[]>(pinFinal(initial))
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(initial.length === 0)

  const errors = validateBaseline(rows)
  const dirty = JSON.stringify(rows) !== JSON.stringify(pinFinal(initial))

  function addRow() {
    setRows((prev) => {
      const next = prev.length === 0
        ? [{ periodMonth: thisMonth(), cumPlannedPct: 100 }]
        : [...prev, { periodMonth: addMonth(prev[prev.length - 1]!.periodMonth, 1), cumPlannedPct: 100 }]
      return pinFinal(next)
    })
  }
  function removeLast() {
    setRows((prev) => pinFinal(prev.slice(0, -1)))
  }
  function setPct(i: number, v: string) {
    setRows((prev) => pinFinal(prev.map((r, j) => (j === i ? { ...r, cumPlannedPct: v === '' ? 0 : Number(v) } : r))))
  }
  function setStart(iso: string) {
    // Re-anchor the whole contiguous run from a new start month.
    setRows((prev) => pinFinal(prev.map((r, i) => ({ ...r, periodMonth: addMonth(iso, i) }))))
  }

  async function save() {
    if (errors.length > 0) return
    setBusy(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/baseline`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseline: rows }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not save the baseline.')
      router.refresh()
      showToast(rows.length === 0 ? 'Baseline cleared.' : `Baseline saved — ${rows.length} month(s).`, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save the baseline.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Baseline (planned S-curve)</h2>
          <p className="text-xs text-fg-subtle">
            Cumulative planned % of budget by month-end — the only plan you enter by hand. Progress is always measured from the field.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Edit baseline'}</Button>
      </div>

      {open && (
        <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
          {rows.length === 0 ? (
            <p className="text-sm text-fg-subtle">No baseline yet — planned value and SPI show as “N/A”. Add the first month to start the curve.</p>
          ) : (
            <>
              <div className="w-40">
                <Input
                  label="Start month"
                  type="month"
                  value={rows[0]!.periodMonth.slice(0, 7)}
                  onChange={(e) => e.target.value && setStart(`${e.target.value}-01`)}
                />
              </div>
              <div className="divide-y divide-border rounded-md border border-border">
                {rows.map((r, i) => {
                  const isFinal = i === rows.length - 1
                  return (
                    <div key={r.periodMonth} className="flex items-center gap-3 px-3 py-2">
                      <span className="w-28 text-sm text-fg">{label(r.periodMonth)}</span>
                      <input
                        type="number" min={0} max={100} step="any" inputMode="decimal"
                        value={r.cumPlannedPct}
                        onChange={(e) => setPct(i, e.target.value)}
                        disabled={isFinal}
                        className="w-24 rounded-md border border-border bg-surface px-2 py-1.5 text-sm tabular-nums text-fg disabled:opacity-60"
                      />
                      <span className="text-xs text-fg-subtle">
                        % cumulative{isFinal ? ' · final month pinned to 100%' : ''}
                      </span>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={addRow}>+ Add month</Button>
            {rows.length > 0 && <Button size="sm" variant="ghost" onClick={removeLast}>Remove last</Button>}
            {rows.length > 0 && <Button size="sm" variant="ghost" onClick={() => setRows([])}>Clear</Button>}
          </div>

          {errors.length > 0 && (
            <ul className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
              {errors.map((e, i) => (<li key={i}>{e.message}</li>))}
            </ul>
          )}

          <div className="flex items-center gap-2 border-t border-border pt-3">
            <Button onClick={save} loading={busy} disabled={errors.length > 0 || !dirty}>Save baseline</Button>
            {!dirty && <span className="text-xs text-fg-subtle">No changes.</span>}
          </div>
        </div>
      )}
    </section>
  )
}
