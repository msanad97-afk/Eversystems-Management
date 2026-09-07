'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/** Creates the DRAFT opening report and reloads the page onto its editor. */
export function CreateOpeningReport({ projectId }: { projectId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/opening-report`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error ?? 'Could not create the opening report.'); return }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={create}
        disabled={busy}
        className="rounded-md bg-primary-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-800 disabled:opacity-50"
      >
        {busy ? 'Creating…' : 'Create opening balance'}
      </button>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  )
}
