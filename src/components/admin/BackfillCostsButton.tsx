'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/contexts/ToastContext'

/**
 * Backfill costs for reports approved before Phase 6B captured them. The result is an
 * APPROXIMATION (today's rates, not the rates at approval), so the confirm says so plainly
 * and every backfilled figure is badged wherever it appears.
 */
export function BackfillCostsButton({ projectId }: { projectId: string }) {
  const router = useRouter()
  const { showToast } = useToast()
  const [busy, setBusy] = useState(false)

  async function run() {
    const ok = confirm(
      'Backfill actual cost for previously-approved reports?\n\n' +
        'These will be costed at TODAY’S rates — not the rates in force when they were approved — ' +
        'so the result is an APPROXIMATION, not a measured cost.\n\n' +
        'Every affected report is stamped and shown as "approx" in the panel and exports. ' +
        'Reports that already carry approval-time costs are left untouched. This is recorded in the audit log.',
    )
    if (!ok) return
    setBusy(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/backfill-costs`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not backfill.')
      router.refresh()
      showToast(
        data.reportsBackfilled === 0
          ? 'Nothing to backfill — all approved reports already carry costs.'
          : `Backfilled ${data.reportsBackfilled} report(s) — BHD ${data.totalCost} (approximate)${data.unpricedEntries ? `, ${data.unpricedEntries} still unpriced` : ''}.`,
        'success',
      )
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not backfill.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant="secondary" size="sm" onClick={run} loading={busy}>
      Backfill costs
    </Button>
  )
}
