'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ReportStatus } from '@prisma/client'
import { Button } from '@/components/ui/Button'
import { ReportStatusBadge } from '@/components/reports/ReportStatusBadge'
import { computeReportTotals } from '@/lib/reports/rules'
import { useToast } from '@/contexts/ToastContext'

export interface RoManpower { id: string; categoryName: string; headcount: number; hours: number }
export interface RoMaterial { id: string; materialName: string; unit: string; quantity: number }
export interface RoActivity {
  id: string
  assetName: string
  activityRef: string | null
  activityName: string
  unit: string
  quantityDone: number
  cumulativePercent: number
  note: string | null
  manpower: RoManpower[]
  materials: RoMaterial[]
}
export interface ReportDetail {
  id: string
  reportCode: string
  reportDate: string
  status: ReportStatus
  weather: string | null
  generalNotes: string | null
  reviewNote: string | null
  project: { name: string; projectCode: string }
  author: { name: string }
  activities: RoActivity[]
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  })
}
function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export function ReportReadOnlyView({ report, canRecall }: { report: ReportDetail; canRecall: boolean }) {
  const router = useRouter()
  const { showToast } = useToast()
  const [recalling, setRecalling] = useState(false)

  const totals = computeReportTotals(report.activities)

  // Group activities by asset (preserving first-seen order).
  const groups: { assetName: string; activities: RoActivity[] }[] = []
  for (const a of report.activities) {
    let g = groups.find((x) => x.assetName === a.assetName)
    if (!g) { g = { assetName: a.assetName, activities: [] }; groups.push(g) }
    g.activities.push(a)
  }

  async function recall() {
    setRecalling(true)
    try {
      const res = await fetch(`/api/reports/${report.id}/recall`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not recall.')
      showToast('Recalled to draft.', 'success')
      router.refresh()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not recall.', 'error')
    } finally {
      setRecalling(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-fg">{report.project.name}</h1>
            <p className="text-sm text-fg-muted">{formatDate(report.reportDate)}</p>
            <p className="mono mt-1 text-xs text-fg-subtle">{report.reportCode} · {report.author.name}</p>
          </div>
          <ReportStatusBadge status={report.status} />
        </div>
        {report.weather && <p className="mt-2 text-sm text-fg-muted">Weather: {report.weather}</p>}
        {report.status === 'REJECTED' && report.reviewNote && (
          <div className="mt-3 rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
            <span className="font-semibold">Returned:</span> {report.reviewNote}
          </div>
        )}
        {canRecall && (
          <div className="mt-3">
            <Button variant="secondary" onClick={recall} loading={recalling}>Recall to edit</Button>
          </div>
        )}
      </div>

      {report.activities.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-4 text-sm text-fg-subtle">
          No activities recorded.
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.assetName} className="rounded-lg border border-border bg-surface p-4">
            <h2 className="mb-2 font-semibold text-fg">{g.assetName}</h2>
            <div className="space-y-3">
              {g.activities.map((a) => (
                <div key={a.id} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-fg">
                      {a.activityRef ? `${a.activityRef} · ` : ''}{a.activityName}
                    </span>
                    <span className="text-sm text-fg-muted">
                      {a.quantityDone} {a.unit} · {round1(a.cumulativePercent)}% complete
                    </span>
                  </div>
                  {a.note && <p className="mt-1 text-sm text-fg-muted">{a.note}</p>}

                  {a.manpower.length > 0 && (
                    <ul className="mt-2 space-y-0.5">
                      {a.manpower.map((m) => (
                        <li key={m.id} className="flex justify-between text-sm text-fg">
                          <span>{m.categoryName}</span>
                          <span className="text-fg-muted">{m.headcount} × {m.hours}h = {m.headcount * m.hours} man-hrs</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {a.materials.length > 0 && (
                    <ul className="mt-2 space-y-0.5 border-t border-border pt-2">
                      {a.materials.map((m) => (
                        <li key={m.id} className="flex justify-between text-sm text-fg">
                          <span>{m.materialName}</span>
                          <span className="text-fg-muted">{m.quantity} {m.unit}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))
      )}

      {report.activities.length > 0 && (
        <div className="rounded-lg border border-border bg-surface px-4 py-3 text-sm font-medium text-fg">
          Total: {totals.workers} workers · {totals.manHours} man-hours
        </div>
      )}

      {report.generalNotes && (
        <section className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-2 font-semibold text-fg">General notes</h2>
          <p className="whitespace-pre-wrap text-sm text-fg">{report.generalNotes}</p>
        </section>
      )}
    </div>
  )
}
