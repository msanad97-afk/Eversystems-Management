import type { EmailSendStatus } from '@prisma/client'
import { Badge } from '@/components/ui/Badge'
import type { EmailSendHistoryRow } from '@/lib/email/history.server'

const STATUS: Record<EmailSendStatus, { label: string; tone: 'success' | 'danger' | 'neutral' }> = {
  SENT: { label: 'Sent', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
  PENDING: { label: 'Pending', tone: 'neutral' },
}

/** Who sent this document, to whom, and when. Failed attempts are shown, not hidden. */
export function EmailHistory({ sends }: { sends: EmailSendHistoryRow[] }) {
  if (sends.length === 0) return null

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="mb-3 text-sm font-medium text-fg">Email history</p>
      <ul className="space-y-3">
        {sends.map((s) => {
          const { label, tone } = STATUS[s.status]
          return (
            <li key={s.id} className="border-b border-border pb-3 last:border-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={tone}>{label}</Badge>
                <span className="text-sm text-fg">{s.sentByName}</span>
                <span className="text-xs text-fg-subtle">{s.at}</span>
              </div>
              <p className="mt-1 break-words text-xs text-fg-muted">To: {s.recipients.join(', ')}</p>
              {s.attachmentName && <p className="mono mt-0.5 text-[11px] text-fg-subtle">{s.attachmentName}</p>}
              {s.status === 'FAILED' && s.errorMessage && (
                <p className="mt-1 text-xs text-danger">Not delivered: {s.errorMessage}</p>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
