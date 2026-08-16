'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/contexts/ToastContext'
import type { MaterialOption } from '@/components/reports/formTypes'
import { newKey } from '@/components/reports/formTypes'
import type { StockCountView } from '@/lib/inventory/stockCount.server'

/** Current derived on-hand per material, for display guidance while counting. Quantities only. */
export interface StockBalanceHint {
  materialId: string
  onHand: number
  unit: string
}

interface LineDraft {
  key: string
  materialId: string
  counted: string
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, ''))

/**
 * Stock-count editor on the daily report (supervisor). QUANTITIES ONLY — no cost anywhere. The
 * supervisor counts physical stock; each line shows the system-expected on-hand (derived) as
 * guidance and the live variance. Saving replaces the report's count; on submit a non-zero variance
 * reconciles the ledger. Partial counts are legal.
 */
export function StockCountSection({
  reportId,
  initialStockCount,
  materials,
  balances,
}: {
  reportId: string
  initialStockCount: StockCountView | null
  materials: MaterialOption[]
  balances: StockBalanceHint[]
}) {
  const { showToast } = useToast()
  const balanceById = new Map(balances.map((b) => [b.materialId, b]))
  const activeMaterials = materials.filter((m) => m.isActive)

  const seed: LineDraft[] = initialStockCount && initialStockCount.lines.length > 0
    ? initialStockCount.lines.map((l) => ({ key: newKey(), materialId: l.materialId, counted: String(l.countedQuantity) }))
    : [{ key: newKey(), materialId: '', counted: '' }]

  const [lines, setLines] = useState<LineDraft[]>(seed)
  const [notes, setNotes] = useState(initialStockCount?.notes ?? '')
  const [savedAt, setSavedAt] = useState<string | null>(initialStockCount?.countedAt ?? null)
  const [busy, setBusy] = useState(false)

  // Materials already chosen on another line can't be picked again.
  const chosen = new Set(lines.map((l) => l.materialId).filter(Boolean))

  function setLine(i: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  }

  async function save() {
    const payloadLines = lines
      .filter((l) => l.materialId && l.counted !== '' && Number.isFinite(Number(l.counted)) && Number(l.counted) >= 0)
      .map((l) => ({ materialId: l.materialId, countedQuantity: Number(l.counted) }))
    if (new Set(payloadLines.map((l) => l.materialId)).size !== payloadLines.length) {
      showToast('Each material can be counted only once.', 'error'); return
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/reports/${reportId}/stock-counts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: notes.trim() || null, lines: payloadLines }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not save the stock count.')
      const saved = data.stockCount as StockCountView | null
      setSavedAt(saved?.countedAt ?? null)
      showToast(payloadLines.length > 0 ? 'Stock count saved.' : 'Stock count cleared.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save the stock count.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Stock count</h2>
        {savedAt && <span className="text-xs text-fg-subtle">Saved</span>}
      </div>
      <p className="text-xs text-fg-subtle">
        Count physical stock on site. Leave a material out if you did not count it. On submit, any difference from the
        expected quantity adjusts the running balance.
      </p>

      <div className="rounded-lg border border-border bg-surface p-3">
        <div className="space-y-1.5">
          {lines.map((l, i) => {
            const hint = l.materialId ? balanceById.get(l.materialId) : undefined
            const system = hint?.onHand ?? 0
            const unit = hint?.unit ?? activeMaterials.find((m) => m.id === l.materialId)?.unit ?? ''
            const counted = l.counted === '' ? null : Number(l.counted)
            const variance = counted == null || !Number.isFinite(counted) ? null : Math.round((counted - system) * 1000) / 1000
            return (
              <div key={l.key} className="flex flex-wrap items-center gap-2">
                <select
                  value={l.materialId}
                  onChange={(e) => setLine(i, { materialId: e.target.value })}
                  className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-fg"
                >
                  <option value="">Material…</option>
                  {activeMaterials.map((m) => (
                    <option key={m.id} value={m.id} disabled={m.id !== l.materialId && chosen.has(m.id)}>{m.name}</option>
                  ))}
                </select>
                <input
                  type="number" inputMode="decimal" min={0} step="any" placeholder="Counted"
                  value={l.counted}
                  onChange={(e) => setLine(i, { counted: e.target.value })}
                  className="w-24 rounded-md border border-border bg-surface px-2 py-1.5 text-sm tabular-nums text-fg"
                />
                <span className="w-8 text-xs text-fg-subtle">{unit}</span>
                {l.materialId ? (
                  <span className="w-40 text-xs text-fg-muted tabular-nums">
                    system {fmt(system)}
                    {variance != null && variance !== 0 && (
                      <span className={variance < 0 ? 'text-danger' : 'text-warning'}> · Δ {variance > 0 ? '+' : ''}{fmt(variance)}</span>
                    )}
                  </span>
                ) : (
                  <span className="w-40" />
                )}
                <button type="button" onClick={() => setLines((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev))} className="text-fg-subtle hover:text-danger" aria-label="Remove line">✕</button>
              </div>
            )
          })}
          <button type="button" onClick={() => setLines((prev) => [...prev, { key: newKey(), materialId: '', counted: '' }])} className="text-xs font-medium text-primary-700 hover:underline">+ Add material</button>
        </div>

        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notes (optional)" className="mt-2 w-full resize-y rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-fg placeholder:text-fg-subtle" />
        <div className="mt-2 flex justify-end">
          <Button type="button" size="sm" onClick={save} loading={busy}>Save count</Button>
        </div>
      </div>
    </div>
  )
}
