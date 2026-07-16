'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useToast } from '@/contexts/ToastContext'
import { WEATHER_OPTIONS, validateForSubmit, computeReportTotals, type ActivityInput } from '@/lib/reports/rules'
import { ActivityCard } from '@/components/reports/ActivityCard'
import {
  type ActivityRow,
  type AssetOption,
  type CategoryOption,
  type MaterialOption,
  newKey,
} from '@/components/reports/formTypes'

export interface ReportFormData {
  id: string
  reportCode: string
  reportDate: string
  status: string
  weather: string | null
  generalNotes: string | null
  reviewNote: string | null
  project: { name: string; projectCode: string }
  activities: {
    activityId: string
    quantityDone: number
    note: string | null
    manpower: { categoryId: string; headcount: number; hours: number }[]
    materials: { materialId: string; quantity: number }[]
  }[]
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

  const [weather, setWeather] = useState(report.weather ?? '')
  const [generalNotes, setGeneralNotes] = useState(report.generalNotes ?? '')
  const [rows, setRows] = useState<ActivityRow[]>(
    report.activities.map((a) => ({
      key: newKey(),
      activityId: a.activityId,
      quantityDone: String(a.quantityDone),
      note: a.note ?? '',
      manpower: a.manpower.map((m) => ({ key: newKey(), categoryId: m.categoryId, headcount: String(m.headcount), hours: String(m.hours) })),
      materials: a.materials.map((m) => ({ key: newKey(), materialId: m.materialId, quantity: String(m.quantity) })),
    })),
  )

  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const dirty = useRef(false)
  const markDirty = () => { dirty.current = true }

  const stateRef = useRef({ weather, generalNotes, rows })
  stateRef.current = { weather, generalNotes, rows }

  const usedActivityIds = new Set(rows.map((r) => r.activityId).filter(Boolean))

  const totals = computeReportTotals(
    rows.map((r) => ({ manpower: r.manpower.map((m) => ({ headcount: Number(m.headcount), hours: Number(m.hours) })) })),
  )

  const buildPayload = useCallback(() => {
    const s = stateRef.current
    return {
      weather: s.weather || null,
      generalNotes: s.generalNotes.trim() || null,
      activities: s.rows
        .filter((r) => r.activityId !== '')
        .map((r) => ({
          activityId: r.activityId,
          quantityDone: Number(r.quantityDone) || 0,
          note: r.note.trim() || null,
          manpower: r.manpower
            .filter((m) => m.categoryId !== '')
            .map((m) => ({ categoryId: m.categoryId, headcount: Number(m.headcount) || 0, hours: Number(m.hours) || 0 })),
          materials: r.materials
            .filter((m) => m.materialId !== '')
            .map((m) => ({ materialId: m.materialId, quantity: Number(m.quantity) || 0 })),
        })),
    }
  }, [])

  const save = useCallback(
    async (opts?: { silent?: boolean }): Promise<boolean> => {
      if (saving) return false
      setSaving(true)
      try {
        const res = await fetch(`/api/reports/${report.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildPayload()),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error ?? 'Could not save.')
        }
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
    const t = setInterval(() => {
      if (dirty.current) void save({ silent: true })
    }, 20_000)
    return () => clearInterval(t)
  }, [save])

  function buildActivityInputs(): ActivityInput[] {
    const options = scope.flatMap((a) => a.activities)
    return rows
      .filter((r) => r.activityId !== '')
      .map((r) => {
        const opt = options.find((x) => x.id === r.activityId)
        return {
          activityId: r.activityId,
          activityName: opt?.name,
          unit: opt?.unit,
          quantityDone: Number(r.quantityDone) || 0,
          remaining: opt?.remaining ?? 0,
          manpower: r.manpower.filter((m) => m.categoryId).map((m) => ({ categoryId: m.categoryId, headcount: Number(m.headcount) || 0, hours: Number(m.hours) || 0 })),
          materials: r.materials.filter((m) => m.materialId).map((m) => ({ materialId: m.materialId, quantity: Number(m.quantity) || 0 })),
        }
      })
  }

  async function onSubmit() {
    const error = validateForSubmit(buildActivityInputs())
    if (error) {
      showToast(error, 'error')
      setConfirmOpen(false)
      return
    }
    if (!(await save({ silent: true }))) {
      setConfirmOpen(false)
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/reports/${report.id}/submit`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not submit.')
      showToast('Report submitted.', 'success')
      router.push('/')
      router.refresh()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not submit.', 'error')
    } finally {
      setSaving(false)
      setConfirmOpen(false)
    }
  }

  function updateRow(key: string, next: ActivityRow) {
    setRows((prev) => prev.map((r) => (r.key === key ? next : r)))
    markDirty()
  }
  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key))
    markDirty()
  }
  function addActivity() {
    setRows((prev) => [...prev, { key: newKey(), activityId: '', quantityDone: '', note: '', manpower: [], materials: [] }])
    markDirty()
  }

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
            {WEATHER_OPTIONS.map((w) => (
              <option key={w} value={w}>{w}</option>
            ))}
          </Select>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Activities</h2>
          {rows.length > 0 && (
            <span className="text-xs text-fg-muted">{totals.workers} workers · {totals.manHours} man-hours</span>
          )}
        </div>
        {rows.length === 0 && (
          <p className="text-sm text-fg-subtle">Add at least one activity with a quantity to submit.</p>
        )}
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
        <Button type="button" variant="secondary" onClick={addActivity} fullWidth>
          + Add activity
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-surface p-4">
        <label className="mb-1 block text-sm font-medium text-fg">General notes</label>
        <textarea
          value={generalNotes}
          onChange={(e) => { setGeneralNotes(e.target.value); markDirty() }}
          placeholder="Delays, safety notes, visitors…"
          rows={3}
          className="w-full resize-y rounded-md border border-border-strong bg-surface px-3 py-2 text-fg placeholder:text-fg-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface px-4 py-3 pb-safe">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
          <span className="text-xs text-fg-subtle">
            {saving ? 'Saving…' : lastSaved ? `Saved ${lastSaved}` : 'Not saved yet'}
          </span>
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
