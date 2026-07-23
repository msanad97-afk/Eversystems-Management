'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ValuationStatus } from '@prisma/client'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/contexts/ToastContext'

interface Blocker { name: string; detail: string }

function firstOfThisMonth(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Create a DRAFT certificate for a month. Always allowed — only certifying is gated. */
export function NewValuationForm({ projectId }: { projectId: string }) {
  const router = useRouter()
  const { showToast } = useToast()
  const [month, setMonth] = useState(firstOfThisMonth())
  const [busy, setBusy] = useState(false)

  async function create() {
    setBusy(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/valuations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ periodMonth: `${month}-01` }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not create the certificate.')
      showToast(`Draft ${data.valuation.valuationCode} created.`, 'success')
      router.push(`/admin/projects/${projectId}/valuations/${data.valuation.id}`)
      router.refresh()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not create the certificate.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="val-month" className="text-sm text-fg-subtle">Period</label>
      <input
        id="val-month"
        type="month"
        value={month}
        onChange={(e) => setMonth(e.target.value)}
        className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-fg"
      />
      <Button size="sm" onClick={create} disabled={busy || !month}>
        {busy ? 'Creating…' : 'New valuation'}
      </Button>
    </div>
  )
}

/**
 * The certificate's state transitions. Certify is disabled while the gate has blockers, and
 * its confirm spells out that certifying freezes the figures permanently — there is no
 * un-certify, only re-issue.
 */
export function ValuationActions({
  projectId,
  valuationId,
  status,
  superseded,
  blockers,
}: {
  projectId: string
  valuationId: string
  status: ValuationStatus
  superseded: boolean
  blockers: Blocker[]
}) {
  const router = useRouter()
  const { showToast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  async function call(action: string, method: 'POST' | 'PATCH', confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return
    setBusy(action)
    try {
      const url = action === 'recompute'
        ? `/api/projects/${projectId}/valuations/${valuationId}`
        : `/api/projects/${projectId}/valuations/${valuationId}/${action}`
      const res = await fetch(url, { method, ...(method === 'PATCH' ? { headers: { 'content-type': 'application/json' }, body: '{}' } : {}) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const extra = Array.isArray(data.blockers) && data.blockers.length > 0
          ? ` (${data.blockers.map((b: Blocker) => b.name).join(', ')})`
          : ''
        throw new Error(`${data.error ?? 'Action failed.'}${extra}`)
      }
      if (action === 'reissue' && data.valuation?.id) {
        showToast(`Re-issued as ${data.valuation.valuationCode}.`, 'success')
        router.push(`/admin/projects/${projectId}/valuations/${data.valuation.id}`)
      } else {
        showToast(
          action === 'recompute' ? 'Recomputed from current approved progress.'
            : action === 'submit' ? 'Sent to the client.'
            : action === 'recall' ? 'Recalled to draft.'
            : 'Certified — these figures are now frozen.',
          'success',
        )
      }
      router.refresh()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Action failed.', 'error')
    } finally {
      setBusy(null)
    }
  }

  if (superseded) return null

  const isDraft = status === 'DRAFT'
  const canCertify = (isDraft || status === 'SUBMITTED') && blockers.length === 0

  return (
    <div className="flex flex-wrap gap-2">
      {isDraft && (
        <>
          <Button size="sm" variant="secondary" loading={busy === 'recompute'} onClick={() => call('recompute', 'PATCH')}>
            Recompute
          </Button>
          <Button size="sm" variant="secondary" loading={busy === 'submit'} onClick={() => call('submit', 'POST')}>
            Send to client
          </Button>
        </>
      )}
      {(isDraft || status === 'SUBMITTED') && (
        <Button
          size="sm"
          loading={busy === 'certify'}
          disabled={!canCertify}
          onClick={() =>
            call('certify', 'POST',
              'Record the client’s approval of this certificate?\n\n' +
                'This FREEZES its figures and per-asset lines permanently. Later progress, re-measure or ' +
                're-pricing will not change it, and there is no un-certify — a change the client requires ' +
                'is handled by re-issuing, which creates a new revision and leaves this one on record.',
            )
          }
        >
          Certify (client approved)
        </Button>
      )}
      {status === 'SUBMITTED' && (
        <Button
          size="sm"
          variant="secondary"
          loading={busy === 'recall'}
          onClick={() =>
            call('recall', 'POST',
              'Recall this certificate to draft?\n\n' +
                'Use this when the client hands it back before approving. It returns to DRAFT so you can ' +
                'edit and re-submit. (A change AFTER approval is a re-issue, not a recall.)',
            )
          }
        >
          Recall to draft
        </Button>
      )}
      {!canCertify && (isDraft || status === 'SUBMITTED') && blockers.length > 0 && (
        <span className="self-center text-xs text-danger">Certification blocked — see above.</span>
      )}
      {status === 'CERTIFIED' && (
        <Button
          size="sm"
          variant="secondary"
          loading={busy === 'reissue'}
          onClick={() =>
            call('reissue', 'POST',
              'Re-issue this certificate?\n\n' +
                'This revision stays frozen and readable as the record of what the client approved. ' +
                'A new draft revision is created from current approved progress for you to re-submit.',
            )
          }
        >
          Re-issue
        </Button>
      )}
    </div>
  )
}
