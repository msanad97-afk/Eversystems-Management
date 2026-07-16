'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ReportStatus } from '@prisma/client'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { ReportStatusBadge } from '@/components/reports/ReportStatusBadge'
import { useToast } from '@/contexts/ToastContext'

export interface ReviewItem {
  id: string
  reportCode: string
  reportDate: string
  status: ReportStatus
  submittedAt: string | null
  projectName: string
  projectCode: string
  author: string
  workers: number
  manHours: number
  materialsCount: number
}

function fmtDate(iso: string) {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  })
}
function fmtTime(iso: string | null) {
  return iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
}

export function ReviewClient({ items }: { items: ReviewItem[] }) {
  const router = useRouter()
  const { showToast } = useToast()
  const [tab, setTab] = useState<'pending' | 'all'>('pending')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const rows = useMemo(
    () => (tab === 'pending' ? items.filter((i) => i.status === 'SUBMITTED') : items),
    [tab, items],
  )
  const pendingCount = items.filter((i) => i.status === 'SUBMITTED').length

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function bulkApprove() {
    const ids = [...selected]
    if (ids.length === 0) return
    setBusy(true)
    let ok = 0
    for (const id of ids) {
      const res = await fetch(`/api/reports/${id}/approve`, { method: 'POST' })
      if (res.ok) ok += 1
    }
    setBusy(false)
    setSelected(new Set())
    showToast(`Approved ${ok} of ${ids.length} report(s).`, ok === ids.length ? 'success' : 'error')
    router.refresh()
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-fg">Review queue</h1>
        {tab === 'pending' && selected.size > 0 && (
          <Button onClick={bulkApprove} loading={busy}>
            Approve selected ({selected.size})
          </Button>
        )}
      </div>

      <div className="flex gap-1 rounded-lg border border-border bg-surface p-1">
        <button
          type="button"
          onClick={() => setTab('pending')}
          className={`flex-1 rounded-md px-3 py-2 text-sm font-medium ${tab === 'pending' ? 'bg-primary-50 text-primary-700' : 'text-fg-muted'}`}
        >
          Pending ({pendingCount})
        </button>
        <button
          type="button"
          onClick={() => setTab('all')}
          className={`flex-1 rounded-md px-3 py-2 text-sm font-medium ${tab === 'all' ? 'bg-primary-50 text-primary-700' : 'text-fg-muted'}`}
        >
          All
        </button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={tab === 'pending' ? 'Nothing to review' : 'No reports yet'}
          description={tab === 'pending' ? 'Submitted reports will appear here.' : undefined}
        />
      ) : (
        <Table>
          <THead>
            <TR>
              {tab === 'pending' && <TH />}
              <TH>Date</TH>
              <TH>Project</TH>
              <TH>Author</TH>
              <TH>Workers</TH>
              <TH>Man-hrs</TH>
              <TH>Materials</TH>
              <TH>Submitted</TH>
              <TH>Status</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id}>
                {tab === 'pending' && (
                  <TD>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                      aria-label={`Select ${r.reportCode}`}
                    />
                  </TD>
                )}
                <TD className="whitespace-nowrap">{fmtDate(r.reportDate)}</TD>
                <TD className="whitespace-nowrap">{r.projectName}</TD>
                <TD className="whitespace-nowrap text-fg-muted">{r.author}</TD>
                <TD>{r.workers}</TD>
                <TD>{r.manHours}</TD>
                <TD>{r.materialsCount}</TD>
                <TD className="whitespace-nowrap text-fg-muted">{fmtTime(r.submittedAt)}</TD>
                <TD><ReportStatusBadge status={r.status} /></TD>
                <TD>
                  <Link href={`/reports/${r.id}`} className="text-sm font-medium text-primary hover:underline">
                    Open
                  </Link>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  )
}
