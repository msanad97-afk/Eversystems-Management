'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/contexts/ToastContext'

/**
 * Phase 6D — the client bill value for an asset's LUMP-SUM scope. Shown only on assets that
 * actually carry lumpsum cost, because it is the one and only revenue path that scope has:
 * a lumpsum line has no rate and no quantity, so it cannot bill bottom-up like a measured
 * line. Left null, the lump-sum work certifies at zero and the certify gate blocks.
 */
export function LumpsumRevenueInput({
  assetId,
  value,
  contractValue,
}: {
  assetId: string
  value: number | null
  contractValue: number
}) {
  const router = useRouter()
  const { showToast } = useToast()
  const [draft, setDraft] = useState(value == null ? '' : String(value))
  const [busy, setBusy] = useState(false)

  const dirty = draft.trim() !== (value == null ? '' : String(value))

  async function save() {
    const trimmed = draft.trim()
    if (trimmed !== '' && !(Number(trimmed) >= 0)) {
      showToast('Lump-sum revenue must be a non-negative number.', 'error')
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/assets/${assetId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lumpsumRevenue: trimmed === '' ? null : Number(trimmed) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not save.')
      router.refresh()
      showToast(trimmed === '' ? 'Lump-sum revenue cleared.' : 'Lump-sum revenue saved.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-muted px-4 py-2">
      <label htmlFor={`lsr-${assetId}`} className="text-xs font-medium text-fg-subtle">
        Lump-sum revenue (BHD)
      </label>
      <input
        id={`lsr-${assetId}`}
        type="number"
        min="0"
        step="0.001"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="not agreed"
        className="w-32 rounded-md border border-border bg-surface px-2 py-1 text-sm tabular-nums text-fg"
      />
      <Button size="sm" variant="secondary" onClick={save} disabled={busy || !dirty}>
        {busy ? 'Saving…' : 'Save'}
      </Button>
      {value == null ? (
        <span className="text-xs text-danger">
          Not agreed — this asset&apos;s lump-sum work certifies at zero and blocks certification.
        </span>
      ) : (
        <span className="text-xs text-fg-subtle">
          asset contract value {contractValue.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
        </span>
      )}
    </div>
  )
}
