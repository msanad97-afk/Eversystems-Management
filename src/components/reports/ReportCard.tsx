import Link from 'next/link'
import type { ReportStatus } from '@prisma/client'
import { ReportStatusBadge } from '@/components/reports/ReportStatusBadge'

export interface ReportListItem {
  id: string
  reportCode: string
  reportDate: string
  status: ReportStatus
  project: { id: string; projectCode: string; name: string }
  workers: number
  manHours: number
  materialsCount: number
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`)
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

export function ReportCard({ report }: { report: ReportListItem }) {
  return (
    <Link
      href={`/reports/${report.id}`}
      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3 hover:bg-surface-subtle"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-fg">{formatDate(report.reportDate)}</span>
          <ReportStatusBadge status={report.status} />
        </div>
        <p className="truncate text-sm text-fg-muted">{report.project.name}</p>
        <p className="mono text-xs text-fg-subtle">{report.reportCode}</p>
      </div>
      <div className="shrink-0 text-right text-xs text-fg-muted">
        <div>{report.workers} workers</div>
        <div>{report.manHours} man-hrs</div>
        <div>{report.materialsCount} materials</div>
      </div>
    </Link>
  )
}
