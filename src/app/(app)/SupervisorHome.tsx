'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ReportStatus } from '@prisma/client'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { ReportStatusBadge } from '@/components/reports/ReportStatusBadge'
import { ReportCard, type ReportListItem } from '@/components/reports/ReportCard'
import { useToast } from '@/contexts/ToastContext'
import { MAX_BACKDATE_DAYS } from '@/lib/reports/rules'

interface ProjectCard {
  id: string
  name: string
  projectCode: string
  reportable: boolean
  today: { id: string; status: ReportStatus; updatedAt: string } | null
}

function minDate(todayStr: string): string {
  const d = new Date(`${todayStr}T00:00:00.000Z`)
  return new Date(d.getTime() - MAX_BACKDATE_DAYS * 86_400_000).toISOString().slice(0, 10)
}
function savedTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function SupervisorHome({
  firstName,
  todayStr,
  projects,
  recent,
}: {
  firstName: string
  todayStr: string
  projects: ProjectCard[]
  recent: ReportListItem[]
}) {
  const router = useRouter()
  const { showToast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [prevOpen, setPrevOpen] = useState(false)

  const today = new Date(`${todayStr}T00:00:00.000Z`).toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  })

  async function openOrCreate(projectId: string, reportDate: string, tag: string) {
    setBusy(tag)
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, reportDate }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 201) {
        router.push(`/reports/${data.report.id}`)
        return
      }
      if (res.status === 409 && data.existingId) {
        router.push(`/reports/${data.existingId}`)
        return
      }
      throw new Error(data.error ?? 'Could not open report.')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not open report.', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-fg">Hello, {firstName}</h1>
        <p className="text-sm text-fg-subtle">{today}</p>
      </div>

      {/* Today's report per project */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Today&apos;s report</h2>
        {projects.length === 0 ? (
          <EmptyState title="No projects assigned" description="Ask your administrator to assign you to a project." />
        ) : (
          projects.map((p) => (
            <div key={p.id} className="rounded-lg border border-border bg-surface p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-fg">{p.name}</p>
                  <p className="mono text-xs text-fg-subtle">{p.projectCode}</p>
                </div>
                {p.today && <ReportStatusBadge status={p.today.status} />}
              </div>
              <div className="mt-3">
                {!p.today && !p.reportable && (
                  <p className="rounded-md bg-surface-subtle px-3 py-2 text-sm text-fg-muted">
                    Scope not set up yet — contact your administrator.
                  </p>
                )}
                {!p.today && p.reportable && (
                  <Button
                    size="lg"
                    fullWidth
                    loading={busy === p.id}
                    onClick={() => openOrCreate(p.id, todayStr, p.id)}
                  >
                    Start today&apos;s report
                  </Button>
                )}
                {p.today?.status === 'DRAFT' && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-fg-subtle">Saved {savedTime(p.today.updatedAt)}</span>
                    <Link href={`/reports/${p.today.id}`}>
                      <Button variant="secondary">Continue draft</Button>
                    </Link>
                  </div>
                )}
                {p.today?.status === 'SUBMITTED' && (
                  <Link href={`/reports/${p.today.id}`}>
                    <Button variant="secondary" fullWidth>View / recall</Button>
                  </Link>
                )}
                {p.today?.status === 'APPROVED' && (
                  <Link href={`/reports/${p.today.id}`}>
                    <Button variant="secondary" fullWidth>View report</Button>
                  </Link>
                )}
                {p.today?.status === 'REJECTED' && (
                  <Link href={`/reports/${p.today.id}`}>
                    <Button fullWidth>Fix &amp; resubmit</Button>
                  </Link>
                )}
              </div>
            </div>
          ))
        )}
        {projects.some((p) => p.reportable) && (
          <button
            type="button"
            onClick={() => setPrevOpen(true)}
            className="text-sm font-medium text-primary hover:underline"
          >
            Report a previous day
          </button>
        )}
      </section>

      {/* Recent reports */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">My recent reports</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-fg-subtle">Nothing in the last 14 days.</p>
        ) : (
          <div className="space-y-2">
            {recent.map((r) => (
              <ReportCard key={r.id} report={r} />
            ))}
          </div>
        )}
      </section>

      <PreviousDayModal
        open={prevOpen}
        onClose={() => setPrevOpen(false)}
        projects={projects.filter((p) => p.reportable)}
        todayStr={todayStr}
        minStr={minDate(todayStr)}
        busy={busy}
        onGo={openOrCreate}
      />
    </div>
  )
}

function PreviousDayModal({
  open,
  onClose,
  projects,
  todayStr,
  minStr,
  busy,
  onGo,
}: {
  open: boolean
  onClose: () => void
  projects: ProjectCard[]
  todayStr: string
  minStr: string
  busy: string | null
  onGo: (projectId: string, date: string, tag: string) => Promise<void>
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const [date, setDate] = useState(todayStr)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Report a previous day"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            loading={busy === 'prev'}
            disabled={!projectId || !date}
            onClick={() => onGo(projectId, date, 'prev')}
          >
            Open report
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
        <Input
          label="Date"
          type="date"
          min={minStr}
          max={todayStr}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          hint={`Up to ${MAX_BACKDATE_DAYS} days back. Future dates are not allowed.`}
        />
      </div>
    </Modal>
  )
}
