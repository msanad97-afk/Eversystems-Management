'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/contexts/ToastContext'
import {
  type ProjectScopeOption,
  type MatOption,
  type MaterialSignal,
  type ExistingRequest,
  fmtQty,
} from '@/components/materialRequests/types'

interface LineRow {
  key: string
  materialId: string
  quantity: string
  note: string
}

let keySeq = 0
const newKey = () => `mrl-${(keySeq += 1)}`

/**
 * Create/edit a material request. Supervisor-facing → QUANTITIES ONLY. Live budget signals are
 * fetched from /api/material-requests/scope-signals (a cost-free projection) whenever the scope
 * changes; "this request" and "used" track what the supervisor types.
 */
export function RequestForm({
  projects,
  materials,
  existing,
}: {
  projects: ProjectScopeOption[]
  materials: MatOption[]
  existing?: ExistingRequest
}) {
  const router = useRouter()
  const { showToast } = useToast()

  const [projectId, setProjectId] = useState(existing?.projectId ?? (projects[0]?.id ?? ''))
  const [assetId, setAssetId] = useState(existing?.assetId ?? '')
  const [activityId, setActivityId] = useState(existing?.activityId ?? '')
  const [lines, setLines] = useState<LineRow[]>(
    existing?.lines.map((l) => ({ key: newKey(), materialId: l.materialId, quantity: String(l.requestedQty), note: l.note ?? '' })) ?? [],
  )
  const [signals, setSignals] = useState<Map<string, MaterialSignal>>(new Map())
  const [busy, setBusy] = useState(false)

  const project = projects.find((p) => p.id === projectId)
  const asset = project?.assets.find((a) => a.id === assetId)

  // Fetch quantities-only signals whenever the scope changes.
  useEffect(() => {
    if (!projectId) { setSignals(new Map()); return }
    const params = new URLSearchParams({ projectId })
    if (assetId) params.set('assetId', assetId)
    if (activityId) params.set('activityId', activityId)
    if (existing) params.set('excludeRequestId', existing.id)
    let cancelled = false
    fetch(`/api/material-requests/scope-signals?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : { signals: [] }))
      .then((data: { signals: MaterialSignal[] }) => {
        if (!cancelled) setSignals(new Map(data.signals.map((s) => [s.materialId, s])))
      })
      .catch(() => { if (!cancelled) setSignals(new Map()) })
    return () => { cancelled = true }
  }, [projectId, assetId, activityId, existing])

  function setProject(id: string) { setProjectId(id); setAssetId(''); setActivityId('') }
  function setAsset(id: string) { setAssetId(id); setActivityId('') }
  function updateLine(key: string, patch: Partial<LineRow>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }
  function addLine() { setLines((prev) => [...prev, { key: newKey(), materialId: '', quantity: '', note: '' }]) }
  function removeLine(key: string) { setLines((prev) => prev.filter((l) => l.key !== key)) }

  const buildBody = useCallback(() => ({
    projectId,
    assetId: assetId || null,
    activityId: activityId || null,
    lines: lines
      .filter((l) => l.materialId && Number(l.quantity) > 0)
      .map((l) => ({ materialId: l.materialId, requestedQty: Number(l.quantity), note: l.note.trim() || null })),
  }), [projectId, assetId, activityId, lines])

  const save = useCallback(async (): Promise<string | null> => {
    const body = buildBody()
    if (body.lines.length === 0) { showToast('Add at least one material with a quantity.', 'error'); return null }
    const url = existing ? `/api/material-requests/${existing.id}` : '/api/material-requests'
    const method = existing ? 'PATCH' : 'POST'
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { showToast(data.error ?? 'Could not save.', 'error'); return null }
    return existing ? existing.id : data.request?.id ?? null
  }, [buildBody, existing, showToast])

  async function onSaveDraft() {
    setBusy(true)
    const id = await save()
    setBusy(false)
    if (id) { showToast('Draft saved.', 'success'); router.push(`/requests/${id}`); router.refresh() }
  }

  async function onSubmit() {
    setBusy(true)
    const id = await save()
    if (!id) { setBusy(false); return }
    const res = await fetch(`/api/material-requests/${id}/submit`, { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { showToast(data.error ?? 'Could not submit.', 'error'); return }
    showToast('Request submitted.', 'success')
    router.push(`/requests/${id}`); router.refresh()
  }

  const activities = asset?.activities ?? []

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-subtle">Scope</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-fg">Project</span>
            <select value={projectId} onChange={(e) => setProject(e.target.value)} className="w-full rounded-md border border-border bg-surface px-2 py-2 text-sm text-fg">
              {projects.length === 0 && <option value="">No projects assigned</option>}
              {projects.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-fg">Asset <span className="text-fg-subtle">(optional)</span></span>
            <select value={assetId} onChange={(e) => setAsset(e.target.value)} className="w-full rounded-md border border-border bg-surface px-2 py-2 text-sm text-fg" disabled={!project}>
              <option value="">Whole project</option>
              {project?.assets.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-fg">Activity <span className="text-fg-subtle">(optional)</span></span>
            <select value={activityId} onChange={(e) => setActivityId(e.target.value)} className="w-full rounded-md border border-border bg-surface px-2 py-2 text-sm text-fg" disabled={!asset}>
              <option value="">Whole asset</option>
              {activities.map((a) => (<option key={a.id} value={a.id}>{a.ref ? `${a.ref} · ` : ''}{a.name}</option>))}
            </select>
          </label>
        </div>
        <p className="mt-2 text-xs text-fg-subtle">Budget signals compare against the level you pick.</p>
      </div>

      <div className="rounded-lg border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-fg-subtle">Materials</h2>
        <div className="space-y-3">
          {lines.length === 0 && <p className="text-sm text-fg-subtle">Add the materials you need.</p>}
          {lines.map((l) => {
            const signal = l.materialId ? signals.get(l.materialId) : undefined
            const mat = materials.find((m) => m.id === l.materialId)
            const unit = signal?.unit ?? mat?.unit ?? ''
            const thisQty = Number(l.quantity) || 0
            return (
              <div key={l.key} className="rounded-md border border-border p-3">
                <div className="flex items-center gap-2">
                  <select value={l.materialId} onChange={(e) => updateLine(l.key, { materialId: e.target.value })} className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-fg">
                    <option value="">Material…</option>
                    {materials.map((m) => (<option key={m.id} value={m.id}>{m.name}{m.isActive ? '' : ' (inactive)'}</option>))}
                  </select>
                  <input type="number" inputMode="decimal" min={0} step="any" placeholder="Qty" value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value })} className="w-24 rounded-md border border-border bg-surface px-2 py-1.5 text-sm tabular-nums text-fg" />
                  <span className="w-10 text-xs text-fg-subtle">{unit}</span>
                  <button type="button" onClick={() => removeLine(l.key)} className="text-fg-subtle hover:text-danger" aria-label="Remove line">✕</button>
                </div>
                {l.materialId !== '' && <BudgetSignalLine signal={signal} thisQty={thisQty} unit={unit} />}
                <input type="text" placeholder="Note (optional)" value={l.note} onChange={(e) => updateLine(l.key, { note: e.target.value })} className="mt-2 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-fg placeholder:text-fg-subtle" />
              </div>
            )
          })}
          <button type="button" onClick={addLine} className="text-sm font-medium text-primary-700 hover:underline">+ Add material</button>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onSaveDraft} loading={busy} disabled={!projectId}>Save draft</Button>
        <Button onClick={onSubmit} loading={busy} disabled={!projectId}>Submit</Button>
      </div>
    </div>
  )
}

/** Muted, quantities-only signal under a material line. Never any cost. */
function BudgetSignalLine({ signal, thisQty, unit }: { signal: MaterialSignal | undefined; thisQty: number; unit: string }) {
  if (!signal || signal.budgetedQty == null) {
    const pending = signal && signal.pending > 0 ? ` · ${fmtQty(signal.pending)} pending` : ''
    const soFar = signal ? ` · ${fmtQty(signal.requestedSoFar)} requested so far` : ''
    return <p className="mt-1 text-[11px] text-fg-subtle">no budget set{soFar}{pending} · this request {fmtQty(thisQty)} {unit}</p>
  }
  const remaining = signal.budgetedQty - signal.requestedSoFar
  const remainingLabel = remaining >= 0 ? `${fmtQty(remaining)} left` : `${fmtQty(-remaining)} over`
  const pending = signal.pending > 0 ? ` · ${fmtQty(signal.pending)} pending` : ''
  return (
    <p className="mt-1 text-[11px] tabular-nums text-fg-subtle">
      {fmtQty(signal.requestedSoFar)} of {fmtQty(signal.budgetedQty)} {unit} requested · {remainingLabel}{pending} · this request {fmtQty(thisQty)}
    </p>
  )
}
