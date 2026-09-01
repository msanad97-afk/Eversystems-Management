'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { NotificationType } from '@prisma/client'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { useToast } from '@/contexts/ToastContext'

export interface ListSection {
  type: NotificationType
  label: string
  description: string
  recipients: { id: string; address: string; isUser: boolean }[]
}

export function NotificationListsManager({
  sections,
  candidates,
}: {
  sections: ListSection[]
  candidates: { id: string; name: string; email: string }[]
}) {
  const router = useRouter()
  const { showToast } = useToast()
  const [busy, setBusy] = useState(false)

  async function call(method: string, url: string, body?: unknown): Promise<boolean> {
    setBusy(true)
    try {
      const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong.')
      router.refresh()
      return true
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Something went wrong.', 'error')
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {sections.map((section) => (
        <section key={section.type} className="rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-fg">{section.label}</h2>
          <p className="mt-0.5 text-xs text-fg-subtle">{section.description}</p>

          <ul className="mt-3 space-y-1">
            {section.recipients.length === 0 && <li className="text-sm text-fg-subtle">No recipients yet.</li>}
            {section.recipients.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-sm">
                <span className="text-fg">{r.address}</span>
                {r.isUser ? <Badge tone="info">app user</Badge> : <Badge tone="neutral">external</Badge>}
                <span className="flex-1" />
                <Button size="sm" variant="ghost" className="text-danger" disabled={busy} onClick={() => call('DELETE', `/api/admin/notification-recipients/${r.id}`)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>

          <AddRecipient
            candidates={candidates}
            busy={busy}
            onAdd={(body) => call('POST', '/api/admin/notification-recipients', { type: section.type, ...body })}
          />
        </section>
      ))}
    </div>
  )
}

function AddRecipient({
  candidates,
  busy,
  onAdd,
}: {
  candidates: { id: string; name: string; email: string }[]
  busy: boolean
  onAdd: (body: { userId?: string; address?: string }) => Promise<boolean>
}) {
  const [mode, setMode] = useState<'user' | 'address'>('user')
  const [userId, setUserId] = useState('')
  const [address, setAddress] = useState('')

  const valid = mode === 'user' ? !!userId : address.trim() !== ''

  async function submit() {
    if (!valid) return
    const ok = mode === 'user' ? await onAdd({ userId }) : await onAdd({ address: address.trim() })
    if (ok) { setUserId(''); setAddress('') }
  }

  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
      <div className="flex gap-1">
        {(['user', 'address'] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} className={`rounded-md px-2.5 py-1 text-xs font-medium ${mode === m ? 'bg-primary-50 text-primary-700' : 'text-fg-muted'}`}>
            {m === 'user' ? 'App user' : 'Email address'}
          </button>
        ))}
      </div>
      {mode === 'user' ? (
        <div className="min-w-[45%] flex-1">
          <Select label="User" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Choose a user…</option>
            {candidates.map((c) => (<option key={c.id} value={c.id}>{c.name} ({c.email})</option>))}
          </Select>
        </div>
      ) : (
        <div className="min-w-[45%] flex-1">
          <Input label="Email address" type="email" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="name@example.com" />
        </div>
      )}
      <Button size="sm" onClick={submit} loading={busy} disabled={!valid}>Add</Button>
    </div>
  )
}
