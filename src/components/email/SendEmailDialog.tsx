'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/contexts/ToastContext'

/**
 * Admin-only "Send by email" action. The dialog always shows the attachment filename, so the
 * sender knows exactly which document is leaving before they confirm — and on failure it says
 * plainly that the send was NOT made rather than closing as if it had worked.
 */

export interface RecipientCandidate {
  id: string
  name: string
  email: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function SendEmailDialog({
  entityType,
  entityId,
  entityCode,
  attachmentName,
  users,
}: {
  entityType: 'DAILY_REPORT' | 'MATERIAL_REQUEST'
  entityId: string
  entityCode: string
  attachmentName: string
  users: RecipientCandidate[]
}) {
  const router = useRouter()
  const { showToast } = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [addresses, setAddresses] = useState<string[]>([])
  const [draftAddress, setDraftAddress] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)

  const total = selected.length + addresses.length

  function reset() {
    setSelected([])
    setAddresses([])
    setDraftAddress('')
    setMessage('')
    setError(null)
  }

  function toggleUser(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function addAddress() {
    const value = draftAddress.trim().toLowerCase()
    if (!value) return
    if (!EMAIL_RE.test(value)) {
      setError(`"${draftAddress.trim()}" is not a valid email address.`)
      return
    }
    if (!addresses.includes(value)) setAddresses((prev) => [...prev, value])
    setDraftAddress('')
    setError(null)
  }

  async function send() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType,
          entityId,
          userIds: selected,
          addresses,
          message: message.trim() || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'The email was not sent.')
      const to: string[] = data.recipients ?? []
      showToast(
        `${entityCode} sent to ${to.length === 1 ? to[0] : `${to.length} recipients`}: ${to.join(', ')}`,
        'success',
      )
      setOpen(false)
      reset()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The email was not sent.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Send by email
      </Button>

      <Modal
        open={open}
        onClose={() => (busy ? undefined : setOpen(false))}
        title={`Send ${entityCode} by email`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={send} loading={busy} disabled={total === 0}>
              Send{total > 0 ? ` to ${total}` : ''}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-md border border-border bg-surface-muted px-3 py-2 text-sm text-fg-muted">
            Attachment: <span className="mono font-medium text-fg">{attachmentName}</span>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-fg">People</p>
            <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border border-border p-1">
              {users.length === 0 && <p className="px-2 py-2 text-sm text-fg-subtle">No active users.</p>}
              {users.map((u) => (
                <label
                  key={u.id}
                  className="flex cursor-pointer items-center gap-3 rounded px-2 py-2 hover:bg-surface-muted"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(u.id)}
                    onChange={() => toggleUser(u.id)}
                    className="h-4 w-4 rounded border-border-strong text-primary focus:ring-primary"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-fg">{u.name}</span>
                    <span className="block truncate text-xs text-fg-muted">{u.email}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-fg">Other addresses</p>
            <div className="flex gap-2">
              <input
                type="email"
                value={draftAddress}
                onChange={(e) => setDraftAddress(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addAddress()
                  }
                }}
                placeholder="name@supplier.com"
                className="h-11 min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-3 text-fg placeholder:text-fg-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
              <Button variant="secondary" onClick={addAddress} disabled={!draftAddress.trim()}>
                Add
              </Button>
            </div>
            {addresses.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-2">
                {addresses.map((a) => (
                  <li
                    key={a}
                    className="flex items-center gap-2 rounded-full border border-border bg-surface-muted px-3 py-1 text-xs text-fg"
                  >
                    {a}
                    <button
                      type="button"
                      onClick={() => setAddresses((prev) => prev.filter((x) => x !== a))}
                      className="text-fg-subtle hover:text-danger"
                      aria-label={`Remove ${a}`}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-fg">Message (optional)</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              placeholder="Anything the recipients should know…"
              className="w-full resize-y rounded-md border border-border-strong bg-surface px-3 py-2 text-fg placeholder:text-fg-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </div>

          {error && (
            <p className="rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger" role="alert">
              {error} The send was not made.
            </p>
          )}
        </div>
      </Modal>
    </>
  )
}
