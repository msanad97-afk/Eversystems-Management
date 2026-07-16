'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ReportStatus } from '@prisma/client'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { ReportStatusBadge } from '@/components/reports/ReportStatusBadge'

export interface RegisterRow {
  id: string
  reportCode: string
  reportDate: string
  status: ReportStatus
  projectName: string
  author: string
  workers: number
  manHours: number
}

interface Filters {
  projectId: string
  status: string
  authorId: string
  from: string
  to: string
}

function fmtDate(iso: string) {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  })
}

export function RegisterClient({
  rows,
  projects,
  authors,
  filters,
}: {
  rows: RegisterRow[]
  projects: { id: string; name: string; projectCode: string }[]
  authors: { id: string; name: string }[]
  filters: Filters
}) {
  const router = useRouter()

  function setFilter(patch: Partial<Filters>) {
    const next = { ...filters, ...patch }
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(next)) if (v) params.set(k, v)
    router.push(`/admin/reports${params.toString() ? `?${params}` : ''}`)
  }

  const exportQuery = (() => {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v)
    const q = params.toString()
    return `/api/reports/export${q ? `?${q}` : ''}`
  })()

  const hasFilters = Object.values(filters).some(Boolean)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-fg">Reports register</h1>
        <a href={exportQuery}>
          <Button variant="secondary">Export CSV</Button>
        </a>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-5">
        <Select label="Project" value={filters.projectId} onChange={(e) => setFilter({ projectId: e.target.value })}>
          <option value="">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
        <Select label="Status" value={filters.status} onChange={(e) => setFilter({ status: e.target.value })}>
          <option value="">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="SUBMITTED">Submitted</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
        </Select>
        <Select label="Author" value={filters.authorId} onChange={(e) => setFilter({ authorId: e.target.value })}>
          <option value="">All authors</option>
          {authors.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </Select>
        <Input label="From" type="date" value={filters.from} onChange={(e) => setFilter({ from: e.target.value })} />
        <Input label="To" type="date" value={filters.to} onChange={(e) => setFilter({ to: e.target.value })} />
      </div>
      {hasFilters && (
        <button type="button" onClick={() => router.push('/admin/reports')} className="text-sm text-primary hover:underline">
          Clear filters
        </button>
      )}

      {rows.length === 0 ? (
        <EmptyState title="No reports match" description="Try adjusting the filters." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Code</TH>
              <TH>Date</TH>
              <TH>Project</TH>
              <TH>Author</TH>
              <TH>Status</TH>
              <TH>Workers</TH>
              <TH>Man-hrs</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.id}>
                <TD className="mono whitespace-nowrap text-xs text-fg-muted">{r.reportCode}</TD>
                <TD className="whitespace-nowrap">{fmtDate(r.reportDate)}</TD>
                <TD className="whitespace-nowrap">{r.projectName}</TD>
                <TD className="whitespace-nowrap text-fg-muted">{r.author}</TD>
                <TD><ReportStatusBadge status={r.status} /></TD>
                <TD>{r.workers}</TD>
                <TD>{r.manHours}</TD>
                <TD className="whitespace-nowrap">
                  <Link href={`/reports/${r.id}`} className="text-sm font-medium text-primary hover:underline">Open</Link>
                  <a href={`/api/reports/${r.id}/pdf`} target="_blank" rel="noreferrer" className="ml-3 text-sm font-medium text-primary hover:underline">PDF</a>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  )
}
