'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/contexts/ToastContext'

export function ReviewActions({ reportId }: { reportId: string }) {
  const router = useRouter()
  const { showToast } = useToast()
  const [busy, setBusy] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [note, setNote] = useState('')

  async function approve() {
    setBusy(true)
    try {
      const res = await fetch(`/api/reports/${reportId}/approve`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not approve.')
      showToast('Report approved.', 'success')
      router.refresh()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not approve.', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function reject() {
    if (!note.trim()) return
    setBusy(true)
    try {
      const res = await fetch(`/api/reports/${reportId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: note.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not reject.')
      showToast('Report rejected.', 'success')
      setRejectOpen(false)
      setNote('')
      router.refresh()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not reject.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="mb-3 text-sm font-medium text-fg">Review</p>
      <div className="flex gap-2">
        <Button onClick={approve} loading={busy} fullWidth>
          Approve
        </Button>
        <Button variant="danger" onClick={() => setRejectOpen(true)} disabled={busy} fullWidth>
          Reject
        </Button>
      </div>

      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="Reject report"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejectOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={reject} loading={busy} disabled={!note.trim()}>
              Reject &amp; return
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <label className="block text-sm font-medium text-fg">Reason (required)</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Tell the author what to fix…"
            rows={4}
            autoFocus
            className="w-full resize-y rounded-md border border-border-strong bg-surface px-3 py-2 text-fg placeholder:text-fg-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </div>
      </Modal>
    </div>
  )
}
