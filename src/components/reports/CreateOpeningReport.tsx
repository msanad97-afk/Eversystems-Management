'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Creates the DRAFT opening report at an admin-chosen date (pre-filled with the day before the first
 * site report) and reloads the page onto its editor.
 */
export function CreateOpeningReport({ projectId, defaultDate, minDate, maxDate }: { projectId: string; defaultDate: string; minDate: string; maxDate: string | null }) {
  const router = useRouter()
  const [date, setDate] = useState(defaultDate)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/opening-report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reportDate: date }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error ?? 'Could not create the opening report.'); return }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4 text-sm">
      <p className="text-fg">This creates a DRAFT opening report. Date it the day before the first site report so the opening balance sits immediately behind the recorded history — a gap makes any period chart jump with no data behind it.</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Opening date</span>
          <input type="date" value={date} min={minDate} max={maxDate ?? undefined} onChange={(e) => setDate(e.target.value)} className="rounded-md border border-border px-2 py-1.5 text-sm" />
        </label>
        <button
          type="button"
          onClick={create}
          disabled={busy}
          className="rounded-md bg-primary-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-800 disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Create opening balance'}
        </button>
      </div>
      {maxDate && <p className="mt-2 text-xs text-fg-muted">Must be on or after {minDate} and on or before {maxDate} (the day before the first recorded report).</p>}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  )
}
