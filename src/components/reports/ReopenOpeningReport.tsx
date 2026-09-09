'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Admin-only re-open control for an APPROVED opening-balance report. Shown only when the server-side
 * gate would pass. Confirms first — re-opening changes figures across the whole project.
 */
export function ReopenOpeningReport({ reportId }: { reportId: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function reopen() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/reports/${reportId}/reopen`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error ?? 'Could not re-open the report.'); return }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-warning bg-warning-bg px-4 py-3 text-sm">
      <p className="text-warning">This opening balance is approved. Re-opening returns it to a draft so it can be corrected — <span className="font-semibold">figures across the whole project (EVM, the matrix, cost) will change</span> until it is re-approved.</p>
      {!confirming ? (
        <button type="button" onClick={() => setConfirming(true)} className="mt-2 rounded-md border border-warning px-3 py-1.5 text-sm font-medium text-warning hover:bg-warning/10">Re-open opening balance</button>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="font-medium text-fg">Re-open and unlock for editing?</span>
          <button type="button" onClick={reopen} disabled={busy} className="rounded-md bg-warning px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">{busy ? 'Re-opening…' : 'Yes, re-open'}</button>
          <button type="button" onClick={() => setConfirming(false)} disabled={busy} className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg hover:bg-surface-muted">Cancel</button>
        </div>
      )}
      {error && <p className="mt-2 text-danger">{error}</p>}
    </div>
  )
}
