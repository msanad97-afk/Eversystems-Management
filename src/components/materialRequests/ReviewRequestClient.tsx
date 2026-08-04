'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/contexts/ToastContext'
import { fmtQty } from '@/components/materialRequests/types'

export interface ReviewLineData {
  lineId: string
  materialName: string
  unit: string
  requestedQty: number
  note: string | null
  budgetedQty: number | null
  requestedSoFar: number
  pending: number
  unitRate: number | null // ADMIN-only cost rate; null = unpriced
}

function fmtBhd(n: number): string {
  return `BHD ${n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`
}

/**
 * ADMIN review screen: per-line approve / modify / reject, with the cost column and a
 * within-cost-budget signal. Cost is ADMIN-only (rendered from unitRate passed by the server
 * page) and never reaches a supervisor session.
 */
export function ReviewRequestClient({ id, lines }: { id: string; lines: ReviewLineData[] }) {
  const router = useRouter()
  const { showToast } = useToast()
  const [approved, setApproved] = useState<Record<string, string>>(
    Object.fromEntries(lines.map((l) => [l.lineId, String(l.requestedQty)])),
  )
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const totalCost = useMemo(
    () => lines.reduce((sum, l) => sum + (l.unitRate == null ? 0 : (Number(approved[l.lineId]) || 0) * l.unitRate), 0),
    [lines, approved],
  )

  function setQty(lineId: string, v: string) { setApproved((p) => ({ ...p, [lineId]: v })) }

  async function submitReview() {
    const decisions = lines.map((l) => ({ lineId: l.lineId, approvedQty: Number(approved[l.lineId]) || 0 }))
    if (decisions.some((d) => !(d.approvedQty >= 0))) { showToast('Approved quantities must be zero or more.', 'error'); return }
    setBusy(true)
    try {
      const res = await fetch(`/api/material-requests/${id}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisions, note: note.trim() || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not submit review.')
      showToast(`Request ${String(data.status ?? '').toLowerCase().replace('_', ' ')}.`, 'success')
      router.push('/admin/requests'); router.refresh()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not submit review.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {lines.map((l) => {
          const appr = Number(approved[l.lineId]) || 0
          const lineCost = l.unitRate == null ? null : appr * l.unitRate
          const remaining = l.budgetedQty == null ? null : l.budgetedQty - l.requestedSoFar - appr
          return (
            <div key={l.lineId} className="rounded-lg border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-fg">{l.materialName}</p>
                  <p className="text-sm text-fg-muted">Requested {fmtQty(l.requestedQty)} {l.unit}</p>
                  {/* Q3: approved / pending / approving shown as three DISTINCT figures — pending
                      never merges into the approved cumulative. */}
                  <p className="mt-1 text-[11px] tabular-nums text-fg-subtle">
                    {l.budgetedQty == null
                      ? `no budget set · ${fmtQty(l.requestedSoFar)} approved`
                      : `${fmtQty(l.requestedSoFar)} of ${fmtQty(l.budgetedQty)} ${l.unit} approved`}
                    {l.pending > 0 ? ` · ${fmtQty(l.pending)} pending` : ''}
                    {` · approving ${fmtQty(appr)}`}
                  </p>
                  {l.note && <p className="mt-1 text-xs text-fg-muted">Note: {l.note}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <div className="flex items-center gap-1">
                    <input
                      type="number" inputMode="decimal" min={0} step="any"
                      value={approved[l.lineId] ?? ''}
                      onChange={(e) => setQty(l.lineId, e.target.value)}
                      className="w-24 rounded-md border border-border bg-surface px-2 py-1.5 text-right text-sm tabular-nums text-fg"
                      aria-label={`Approved quantity for ${l.materialName}`}
                    />
                    <span className="w-8 text-xs text-fg-subtle">{l.unit}</span>
                  </div>
                  <div className="mt-1 flex justify-end gap-2 text-xs">
                    <button type="button" onClick={() => setQty(l.lineId, String(l.requestedQty))} className="font-medium text-primary-700 hover:underline">Full</button>
                    <button type="button" onClick={() => setQty(l.lineId, '0')} className="font-medium text-danger hover:underline">Reject</button>
                  </div>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-xs">
                <span className="text-fg-muted">
                  Cost: <span className="tabular-nums text-fg">{lineCost == null ? 'unpriced' : fmtBhd(lineCost)}</span>
                </span>
                {remaining != null && (
                  <span className={remaining >= 0 ? 'font-medium text-success' : 'font-medium text-danger'}>
                    {remaining >= 0 ? `within budget · ${fmtQty(remaining)} ${l.unit} left` : `over budget by ${fmtQty(-remaining)} ${l.unit}`}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium text-fg">Total approved cost</span>
          <span className="tabular-nums text-sm font-semibold text-fg">{fmtBhd(totalCost)}</span>
        </div>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-fg">Review note <span className="text-fg-subtle">(optional)</span></span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Reason for a modification or rejection…"
            className="w-full resize-y rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
        </label>
        <div className="mt-3 flex justify-end">
          <Button onClick={submitReview} loading={busy}>Submit review</Button>
        </div>
      </div>
    </div>
  )
}
