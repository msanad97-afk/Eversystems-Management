'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/contexts/ToastContext'
import { WEATHER_OPTIONS, validateForSubmit, computeManpowerTotals, type SubActivityInput } from '@/lib/reports/rules'
import { ActivityCard, emptySubHelper } from '@/components/reports/ActivityCard'
import {
  type ActivityRow,
  type SubRow,
  type AssetOption,
  type SubActivityOption,
  type CategoryOption,
  type MaterialOption,
  newKey,
} from '@/components/reports/formTypes'

export interface ReportEntry {
  subActivityId: string
  quantityDone: number | null
  percentComplete: number | null
  note: string | null
  manpower: { categoryId: string; headcount: number; hours: number }[]
  materials: { materialId: string; quantity: number }[]
}
export interface ReportFormData {
  id: string
  reportCode: string
  reportDate: string
  status: string
  weather: string | null
  generalNotes: string | null
  reviewNote: string | null
  project: { name: string; projectCode: string }
  entries: ReportEntry[]
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  })
}

export function ReportForm({
  report,
  scope,
  categories,
  materials,
}: {
  report: ReportFormData
  scope: AssetOption[]
  categories: CategoryOption[]
  materials: MaterialOption[]
}) {
  const router = useRouter()
  const { showToast } = useToast()

  const allActivities = scope.flatMap((a) => a.activities)
  const subOptById = new Map<string, SubActivityOption>()
  const activityOfSub = new Map<string, string>()
  for (const act of allActivities) {
    for (const s of act.subActivities) {
      subOptById.set(s.id, s)
      activityOfSub.set(s.id, act.id)
    }
  }

  const [weather, setWeather] = useState(report.weather ?? '')
  const [generalNotes, setGeneralNotes] = useState(report.generalNotes ?? '')
  const [rows, setRows] = useState<ActivityRow[]>(() => buildInitialRows(report.entries, scope))

  const [saving, setSaving] = useState(false)
  const [copying, setCopying] = useState(false)
  const [lastSaved, setLastSaved] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const dirty = useRef(false)
  const markDirty = () => { dirty.current = true }
  const stateRef = useRef({ weather, generalNotes, rows })
  stateRef.current = { weather, generalNotes, rows }

  const usedActivityIds = new Set(rows.map((r) => r.activityId).filter(Boolean))
  const includedSubs = rows.flatMap((r) => r.subs.filter((s) => s.included))
  const totals = computeManpowerTotals(includedSubs.flatMap((s) => s.manpower.map((m) => ({ headcount: Number(m.headcount), hours: Number(m.hours) }))))

  const buildPayload = useCallback(() => {
    const s = stateRef.current
    return {
      weather: s.weather || null,
      generalNotes: s.generalNotes.trim() || null,
      subActivities: s.rows
        .flatMap((r) => r.subs.filter((sub) => sub.included))
        .map((sub) => ({
          subActivityId: sub.subActivityId,
          quantityDone: Number(sub.quantityDone) || 0,
          percentComplete: Number(sub.percentComplete) || 0,
          note: sub.note.trim() || null,
          manpower: sub.manpower.filter((m) => m.categoryId !== '').map((m) => ({ categoryId: m.categoryId, headcount: Number(m.headcount) || 0, hours: Number(m.hours) || 0 })),
          materials: sub.materials.filter((m) => m.materialId !== '').map((m) => ({ materialId: m.materialId, quantity: Number(m.quantity) || 0 })),
        })),
    }
  }, [])

  const save = useCallback(
    async (opts?: { silent?: boolean }): Promise<boolean> => {
      if (saving) return false
      setSaving(true)
      try {
        const res = await fetch(`/api/reports/${report.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildPayload()) })
        if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error ?? 'Could not save.') }
        dirty.current = false
        setLastSaved(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
        if (!opts?.silent) showToast('Draft saved.', 'success')
        return true
      } catch (err) {
        if (!opts?.silent) showToast(err instanceof Error ? err.message : 'Could not save.', 'error')
        return false
      } finally {
        setSaving(false)
      }
    },
    [saving, report.id, buildPayload, showToast],
  )

  useEffect(() => {
    const t = setInterval(() => { if (dirty.current) void save({ silent: true }) }, 20_000)
    return () => clearInterval(t)
  }, [save])

  function buildSubInputs(): SubActivityInput[] {
    return includedSubs.map((sub) => {
      const opt = subOptById.get(sub.subActivityId)
      return {
        subActivityId: sub.subActivityId,
        label: opt?.name,
        type: opt?.type ?? 'MEASURED',
        unit: undefined,
        quantityDone: Number(sub.quantityDone) || 0,
        remaining: opt?.remaining ?? 0,
        percentComplete: Number(sub.percentComplete) || 0,
        lastApprovedPercent: opt?.lastApprovedPercent ?? 0,
        manpower: sub.manpower.filter((m) => m.categoryId).map((m) => ({ categoryId: m.categoryId, headcount: Number(m.headcount) || 0, hours: Number(m.hours) || 0 })),
        materials: sub.materials.filter((m) => m.materialId).map((m) => ({ materialId: m.materialId, quantity: Number(m.quantity) || 0 })),
      }
    })
  }

  async function onSubmit() {
    const error = validateForSubmit(buildSubInputs())
    if (error) { showToast(error, 'error'); setConfirmOpen(false); return }
    if (!(await save({ silent: true }))) { setConfirmOpen(false); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/reports/${report.id}/submit`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not submit.')
      showToast('Report submitted.', 'success')
      router.push('/'); router.refresh()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not submit.', 'error')
    } finally {
      setSaving(false); setConfirmOpen(false)
    }
  }

  async function copyYesterday() {
    setCopying(true)
    try {
      const res = await fetch(`/api/reports/${report.id}/copy-source`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not copy.')
      if (!data.source) { showToast('No earlier report to copy from.', 'info'); return }
      setRows((prev) => applyCopySource(prev, data.source.subActivities, scope, activityOfSub))
      markDirty()
      showToast(`Copied crew from ${data.source.date}.`, 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not copy.', 'error')
    } finally {
      setCopying(false)
    }
  }

  function updateRow(key: string, next: ActivityRow) { setRows((prev) => prev.map((r) => (r.key === key ? next : r))); markDirty() }
  function removeRow(key: string) { setRows((prev) => prev.filter((r) => r.key !== key)); markDirty() }
  function addActivity() { setRows((prev) => [...prev, { key: newKey(), activityId: '', subs: [] }]); markDirty() }

  return (
    <div className="space-y-4 pb-28">
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-fg">{report.project.name}</h1>
            <p className="text-sm text-fg-muted">{formatDate(report.reportDate)}</p>
          </div>
          <span className="mono text-xs text-fg-subtle">{report.reportCode}</span>
        </div>
        {report.status === 'REJECTED' && report.reviewNote && (
          <div className="mt-3 rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
            <span className="font-semibold">Returned:</span> {report.reviewNote}
          </div>
        )}
        <div className="mt-3">
          <Select label="Weather" value={weather} onChange={(e) => { setWeather(e.target.value); markDirty() }}>
            <option value="">Not set</option>
            {WEATHER_OPTIONS.map((w) => (<option key={w} value={w}>{w}</option>))}
          </Select>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Work done</h2>
          <div className="flex items-center gap-3">
            {includedSubs.length > 0 && <span className="text-xs text-fg-muted">{totals.workers} workers · {totals.manHours} man-hours</span>}
            <Button type="button" variant="ghost" size="sm" onClick={copyYesterday} loading={copying}>Copy yesterday</Button>
          </div>
        </div>
        {rows.length === 0 && <p className="text-sm text-fg-subtle">Add an activity, then tick the sub-activities you worked on today.</p>}
        {rows.map((row) => (
          <ActivityCard
            key={row.key}
            row={row}
            assets={scope}
            usedActivityIds={usedActivityIds}
            categories={categories}
            materials={materials}
            onChange={(next) => updateRow(row.key, next)}
            onRemove={() => removeRow(row.key)}
          />
        ))}
        <Button type="button" variant="secondary" onClick={addActivity} fullWidth>+ Add activity</Button>
      </div>

      <div className="rounded-lg border border-border bg-surface p-4">
        <label className="mb-1 block text-sm font-medium text-fg">General notes</label>
        <textarea value={generalNotes} onChange={(e) => { setGeneralNotes(e.target.value); markDirty() }} placeholder="Delays, safety notes, visitors…" rows={3}
          className="w-full resize-y rounded-md border border-border-strong bg-surface px-3 py-2 text-fg placeholder:text-fg-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface px-4 py-3 pb-safe">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
          <span className="text-xs text-fg-subtle">{saving ? 'Saving…' : lastSaved ? `Saved ${lastSaved}` : 'Not saved yet'}</span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => save()} loading={saving}>Save draft</Button>
            <Button onClick={() => setConfirmOpen(true)} disabled={saving}>Submit</Button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Submit report"
        message={`Submit the report for ${report.project.name} on ${formatDate(report.reportDate)}? You can recall it until it's reviewed.`}
        confirmLabel="Submit"
        loading={saving}
        onConfirm={onSubmit}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}

// ─── initial state + copy-yesterday helpers ───────────────────────────────────

function buildInitialRows(entries: ReportEntry[], scope: AssetOption[]): ActivityRow[] {
  const entryBySub = new Map(entries.map((e) => [e.subActivityId, e]))
  const rows: ActivityRow[] = []
  for (const asset of scope) {
    for (const act of asset.activities) {
      if (!act.subActivities.some((s) => entryBySub.has(s.id))) continue
      rows.push({
        key: newKey(),
        activityId: act.id,
        subs: act.subActivities.map((opt) => {
          const e = entryBySub.get(opt.id)
          if (!e) return emptySubHelper(opt, false)
          return {
            key: newKey(),
            subActivityId: opt.id,
            included: true,
            quantityDone: e.quantityDone != null ? String(e.quantityDone) : '',
            percentComplete: e.percentComplete != null ? String(e.percentComplete) : '',
            note: e.note ?? '',
            manpower: e.manpower.map((m) => ({ key: newKey(), categoryId: m.categoryId, headcount: String(m.headcount), hours: String(m.hours) })),
            materials: e.materials.map((m) => ({ key: newKey(), materialId: m.materialId, quantity: String(m.quantity) })),
          }
        }),
      })
    }
  }
  return rows
}

function applyCopySource(
  prev: ActivityRow[],
  source: { subActivityId: string; manpower: { categoryId: string; headcount: number; hours: number }[]; materials: { materialId: string; quantity: number }[] }[],
  scope: AssetOption[],
  activityOfSub: Map<string, string>,
): ActivityRow[] {
  const rows = prev.map((r) => ({ ...r, subs: r.subs.map((s) => ({ ...s })) }))
  const allActs = scope.flatMap((a) => a.activities)
  for (const src of source) {
    const activityId = activityOfSub.get(src.subActivityId)
    if (!activityId) continue
    let row = rows.find((r) => r.activityId === activityId)
    if (!row) {
      const act = allActs.find((a) => a.id === activityId)!
      row = { key: newKey(), activityId, subs: act.subActivities.map((opt) => emptySubHelper(opt, false)) }
      rows.push(row)
    }
    const sub = row.subs.find((s) => s.subActivityId === src.subActivityId)
    if (!sub) continue
    sub.included = true
    sub.manpower = src.manpower.map((m) => ({ key: newKey(), categoryId: m.categoryId, headcount: String(m.headcount), hours: String(m.hours) }))
    sub.materials = src.materials.map((m) => ({ key: newKey(), materialId: m.materialId, quantity: String(m.quantity) }))
  }
  return rows
}

// re-export so ActivityCard's helper name is available where needed
export type { SubRow }
