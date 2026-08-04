'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { MaterialRequestStatus } from '@prisma/client'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/contexts/ToastContext'

/** Author actions on a request, gated by status. Reviewed requests are immutable → no actions. */
export function RequestActions({ id, status }: { id: string; status: MaterialRequestStatus }) {
  const router = useRouter()
  const { showToast } = useToast()
  const [busy, setBusy] = useState(false)

  async function call(path: string, method: string, okMsg: string, redirectTo?: string) {
    setBusy(true)
    try {
      const res = await fetch(`/api/material-requests/${id}${path}`, { method })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Action failed.')
      showToast(okMsg, 'success')
      if (redirectTo) router.push(redirectTo)
      router.refresh()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Action failed.', 'error')
    } finally {
      setBusy(false)
    }
  }

  if (status === 'DRAFT') {
    return (
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => call('/submit', 'POST', 'Request submitted.')} loading={busy}>Submit</Button>
        <Link href={`/requests/${id}/edit`}><Button variant="secondary">Edit</Button></Link>
        <Button variant="ghost" onClick={() => call('', 'DELETE', 'Draft deleted.', '/requests')} loading={busy}>Delete</Button>
      </div>
    )
  }
  if (status === 'SUBMITTED') {
    return (
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => call('/recall', 'POST', 'Request recalled to draft.')} loading={busy}>Recall to draft</Button>
      </div>
    )
  }
  return null
}
