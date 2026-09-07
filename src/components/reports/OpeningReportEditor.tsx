'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface OpeningScopeMaterial { materialId: string; materialName: string; unit: string; estimateQty: number }
export interface OpeningScopeSub { subActivityId: string; name: string; type: 'MEASURED' | 'LUMPSUM'; boqQuantity: number; materials: OpeningScopeMaterial[] }
export interface OpeningScopeActivity { activityId: string; assetName: string; ref: string | null; name: string; unit: string; subs: OpeningScopeSub[] }

interface Initial {
  id: string
  reportCode: string
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED'
  reportDate: string
  labourByActivity: Record<string, number>
  subEntries: { subActivityId: string; quantityDone: number | null; percentComplete: number | null; materials: { materialId: string; quantity: number }[] }[]
}

const nz = (v: string): number => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0 }

export function OpeningReportEditor({ activities, initial }: { activities: OpeningScopeActivity[]; initial: Initial }) {
  const router = useRouter()
  const editable = initial.status === 'DRAFT'
  const entryBySub = new Map(initial.subEntries.map((e) => [e.subActivityId, e]))

  // Per-sub progress value (measured = quantity, lumpsum = %) and per-material quantity.
  const [subVal, setSubVal] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const a of activities) for (const s of a.subs) {
      const e = entryBySub.get(s.subActivityId)
      const v = s.type === 'LUMPSUM' ? e?.percentComplete : e?.quantityDone
      out[s.subActivityId] = v != null && v > 0 ? String(v) : ''
    }
    return out
  })
  const [mat, setMat] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const a of activities) for (const s of a.subs) for (const m of s.materials) {
      const e = entryBySub.get(s.subActivityId)
      const existing = e?.materials.find((x) => x.materialId === m.materialId)
      // Pre-fill the budget estimate for a fresh draft; keep the saved value once entered.
      out[`${s.subActivityId}:${m.materialId}`] = existing ? String(existing.quantity) : (initial.subEntries.length === 0 ? String(m.estimateQty) : '')
    }
    return out
  })
  const [labour, setLabour] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const a of activities) { const c = initial.labourByActivity[a.activityId]; out[a.activityId] = c && c > 0 ? String(c) : '' }
    return out
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function markHundred(a: OpeningScopeActivity) {
    setSubVal((prev) => {
      const next = { ...prev }
      for (const s of a.subs) next[s.subActivityId] = s.type === 'LUMPSUM' ? '100' : String(s.boqQuantity)
      return next
    })
  }

  function buildPayload() {
    const subActivities = activities.flatMap((a) => a.subs.map((s) => {
      const materials = s.materials
        .map((m) => ({ materialId: m.materialId, quantity: nz(mat[`${s.subActivityId}:${m.materialId}`] ?? '') }))
        .filter((m) => m.quantity > 0)
      const value = nz(subVal[s.subActivityId] ?? '')
      return { sub: s, value, materials }
    }))
      .filter((x) => x.value > 0 || x.materials.length > 0)
      .map((x) => ({
        subActivityId: x.sub.subActivityId,
        quantityDone: x.sub.type === 'LUMPSUM' ? 0 : x.value,
        percentComplete: x.sub.type === 'LUMPSUM' ? x.value : 0,
        materials: x.materials,
      }))
    const openingLabour = activities.map((a) => ({ activityId: a.activityId, cost: nz(labour[a.activityId] ?? '') })).filter((o) => o.cost > 0)
    return { subActivities, openingLabour }
  }

  async function save(): Promise<boolean> {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/reports/${initial.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(buildPayload()) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error ?? 'Could not save.'); return false }
      return true
    } finally { setBusy(false) }
  }

  async function post(path: string) {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/reports/${initial.id}/${path}`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error ?? `Could not ${path}.`); return }
      router.refresh()
    } finally { setBusy(false) }
  }

  async function saveThenSubmit() { if (await save()) await post('submit') }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-fg-subtle">{initial.reportCode} · dated {initial.reportDate} · <span className="font-medium text-fg">{initial.status}</span></p>
        <div className="flex gap-2">
          {editable && <button type="button" onClick={save} disabled={busy} className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-muted disabled:opacity-50">Save draft</button>}
          {editable && <button type="button" onClick={saveThenSubmit} disabled={busy} className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-surface-muted disabled:opacity-50">Save &amp; submit</button>}
          {initial.status === 'SUBMITTED' && <button type="button" onClick={() => post('approve')} disabled={busy} className="rounded-md bg-primary-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-800 disabled:opacity-50">Approve &amp; commit</button>}
        </div>
      </div>

      {initial.status === 'APPROVED' && <div className="rounded-lg border border-success bg-success-bg px-4 py-3 text-sm text-success">Approved and locked. Opening balances are immutable — corrections flow forward as normal reports.</div>}
      {error && <p className="text-sm text-danger">{error}</p>}

      {activities.map((a) => (
        <div key={a.activityId} className="rounded-lg border border-border bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
            <p className="text-sm font-medium text-fg">{a.ref ? `${a.ref} · ` : ''}{a.name} <span className="text-xs font-normal text-fg-subtle">· {a.assetName}</span></p>
            {editable && <button type="button" onClick={() => markHundred(a)} className="text-xs font-medium text-primary-700 hover:underline">Mark 100% complete</button>}
          </div>
          <div className="space-y-3 p-3">
            {a.subs.map((s) => (
              <div key={s.subActivityId}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-fg">{s.name}</span>
                  <label className="flex items-center gap-1 text-xs text-fg-subtle">
                    {s.type === 'LUMPSUM' ? '% complete' : `qty done (${a.unit || 'unit'}, BOQ ${s.boqQuantity})`}
                    <input inputMode="decimal" disabled={!editable} value={subVal[s.subActivityId] ?? ''} onChange={(e) => setSubVal((p) => ({ ...p, [s.subActivityId]: e.target.value }))} className="w-24 rounded-md border border-border px-2 py-1 text-right text-sm disabled:bg-surface-muted" />
                  </label>
                </div>
                {s.materials.length > 0 && (
                  <div className="mt-2 space-y-1 pl-3">
                    {s.materials.map((m) => (
                      <div key={m.materialId} className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-fg-subtle">{m.materialName} <span className="text-fg-muted">(budget est. {m.estimateQty} {m.unit})</span></span>
                        <input inputMode="decimal" disabled={!editable} value={mat[`${s.subActivityId}:${m.materialId}`] ?? ''} onChange={(e) => setMat((p) => ({ ...p, [`${s.subActivityId}:${m.materialId}`]: e.target.value }))} className="w-24 rounded-md border border-border px-2 py-1 text-right disabled:bg-surface-muted" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <label className="flex items-center justify-between gap-2 border-t border-border pt-3 text-sm">
              <span className="font-medium text-fg">Labour cost (BHD, no hours)</span>
              <input inputMode="decimal" disabled={!editable} value={labour[a.activityId] ?? ''} onChange={(e) => setLabour((p) => ({ ...p, [a.activityId]: e.target.value }))} className="w-32 rounded-md border border-border px-2 py-1 text-right disabled:bg-surface-muted" />
            </label>
          </div>
        </div>
      ))}
    </div>
  )
}
