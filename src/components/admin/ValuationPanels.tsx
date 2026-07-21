import Link from 'next/link'
import type { ValuationStatus } from '@prisma/client'
import type { CertifyBlocker, ValuationSummary, ValuationView } from '@/lib/valuation.server'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'

function bhd(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })
}
function monthLabel(periodMonth: string): string {
  return new Date(`${periodMonth}T00:00:00.000Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

const STATUS_TONE: Record<ValuationStatus, 'neutral' | 'info' | 'success' | 'primary'> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  CERTIFIED: 'success',
  INVOICED: 'primary',
  PAID: 'success',
}

export function ValuationStatusBadge({ status }: { status: ValuationStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{status.toLowerCase()}</Badge>
}

// ─── Certify gate ────────────────────────────────────────────────────────────

/**
 * Report approval tolerates unpriced scope; a client certificate does not — it would silently
 * under-bill. So this is shown wherever certification is possible, and certify is disabled
 * until it clears. Drafting stays allowed throughout.
 */
export function CertifyGatePanel({ blockers }: { blockers: CertifyBlocker[] }) {
  if (blockers.length === 0) return null
  return (
    <div className="rounded-lg border border-danger bg-danger-bg p-4">
      <p className="text-sm font-semibold text-danger">
        Certification blocked — {blockers.length} {blockers.length === 1 ? 'item' : 'items'} would certify at zero
      </p>
      <p className="mt-1 text-xs text-danger">
        Drafting is still allowed, but this certificate cannot be issued to the client until every item below is priced.
      </p>
      <ul className="mt-2 space-y-0.5 text-sm text-danger">
        {blockers.slice(0, 12).map((b, i) => (
          <li key={i}>
            <span className="font-medium">{b.name}</span>
            <span className="text-fg-muted"> — {b.detail}</span>
          </li>
        ))}
        {blockers.length > 12 && <li className="text-fg-muted">…and {blockers.length - 12} more</li>}
      </ul>
    </div>
  )
}

// ─── Certificate list ────────────────────────────────────────────────────────

export function ValuationList({ projectId, valuations }: { projectId: string; valuations: ValuationSummary[] }) {
  if (valuations.length === 0) {
    return (
      <EmptyState
        title="No certificates yet"
        description="Create a valuation for a month — it is computed from approved field progress as of that month-end."
      />
    )
  }
  return (
    <div className="rounded-lg border border-border bg-surface">
      <Table>
        <THead>
          <TR>
            <TH>Period</TH><TH>Certificate</TH><TH>Status</TH>
            <TH className="text-right">Gross to date</TH><TH className="text-right">This period</TH>
            <TH className="text-right">Retention held</TH><TH className="text-right">Net payable</TH>
            <TH>Expected receipt</TH>
          </TR>
        </THead>
        <TBody>
          {valuations.map((v) => (
            <TR key={v.id}>
              <TD>
                <Link href={`/admin/projects/${projectId}/valuations/${v.id}`} className="font-medium text-primary hover:underline">
                  {monthLabel(v.periodMonth)}
                </Link>
              </TD>
              <TD>
                <span className="mono text-xs">{v.valuationCode}</span>
                {v.revisionCount > 1 && <Badge tone="warning" className="ml-2">rev {v.revisionNumber}</Badge>}
              </TD>
              <TD><ValuationStatusBadge status={v.status} /></TD>
              <TD className="text-right tabular-nums">{bhd(v.grossAmount)}</TD>
              <TD className={`text-right tabular-nums ${v.grossThisPeriod < 0 ? 'text-danger' : ''}`}>{bhd(v.grossThisPeriod)}</TD>
              <TD className="text-right tabular-nums">{bhd(v.retentionHeld)}</TD>
              <TD className="text-right font-medium tabular-nums">{bhd(v.netPayable)}</TD>
              <TD className="text-fg-muted">{v.expectedReceipt ?? '—'}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  )
}

// ─── One certificate ─────────────────────────────────────────────────────────

export function ValuationCertificate({ valuation }: { valuation: ValuationView }) {
  const v = valuation
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Figure label="Gross to date" value={bhd(v.grossAmount)} sub={`${v.progressPct}% of contract`} />
        <Figure label="Less previous" value={bhd(v.previousGross)} />
        <Figure label="Gross this period" value={bhd(v.grossThisPeriod)} tone={v.grossThisPeriod < 0 ? 'danger' : undefined} />
        <Figure label="Net payable" value={bhd(v.netPayable)} strong />
      </div>

      <div className="rounded-lg border border-border bg-surface">
        <Table>
          <TBody>
            <SplitRow label="Measured value to date" value={bhd(v.cumulativeMeasured)} />
            <SplitRow label="Lump-sum value to date" value={bhd(v.cumulativeLumpsum)} />
            <SplitRow label="Retention held (cumulative)" value={bhd(v.retentionHeld)} />
            <SplitRow label="Retention this period" value={`(${bhd(v.retentionThisPeriod)})`} />
            <SplitRow label="Advance recovery this period" value={`(${bhd(v.advanceRecovery)})`} />
          </TBody>
        </Table>
      </div>

      {v.status === 'CERTIFIED' && (
        <p className="text-xs text-fg-subtle">
          Certified {v.certifiedAt?.slice(0, 10)} against contract value {bhd(v.contractValueAtCert ?? 0)}
          {v.retentionPctAtCert != null && ` · retention ${v.retentionPctAtCert}%`}
          {v.advancePctAtCert != null && ` · advance ${v.advancePctAtCert}%`}
          {v.expectedReceipt && ` · expected receipt ${v.expectedReceipt}`}
          . These figures are frozen — later progress, re-measure or re-pricing cannot move them.
        </p>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">By asset</h2>
        <div className="rounded-lg border border-border bg-surface">
          <Table>
            <THead>
              <TR>
                <TH>Asset</TH>
                <TH className="text-right">Measured to date</TH><TH className="text-right">Lump-sum to date</TH>
                <TH className="text-right">Gross to date</TH><TH className="text-right">Gross this period</TH>
              </TR>
            </THead>
            <TBody>
              {v.lines.map((l) => (
                <TR key={l.id}>
                  <TD>{l.assetName}</TD>
                  <TD className="text-right tabular-nums">{bhd(l.cumulativeMeasured)}</TD>
                  <TD className="text-right tabular-nums">{bhd(l.cumulativeLumpsum)}</TD>
                  <TD className="text-right tabular-nums">{bhd(l.cumulativeGross)}</TD>
                  <TD className={`text-right tabular-nums ${l.grossThisPeriod < 0 ? 'text-danger' : ''}`}>{bhd(l.grossThisPeriod)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      </section>
    </div>
  )
}

export function RevisionHistoryStrip({
  projectId,
  currentId,
  history,
}: {
  projectId: string
  currentId: string
  history: { id: string; valuationCode: string; revisionNumber: number; status: ValuationStatus; supersededAt: string | null; certifiedAt: string | null; grossAmount: number }[]
}) {
  if (history.length < 2) return null
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Revision history</h2>
      <ul className="space-y-1">
        {history.map((h) => (
          <li key={h.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm">
            <span className="mono text-xs">{h.valuationCode}</span>
            <Badge tone={h.supersededAt ? 'neutral' : 'primary'}>rev {h.revisionNumber}</Badge>
            <ValuationStatusBadge status={h.status} />
            <span className="tabular-nums text-fg-muted">{bhd(h.grossAmount)}</span>
            {h.certifiedAt && <span className="text-xs text-fg-muted">approved {h.certifiedAt.slice(0, 10)}</span>}
            {h.supersededAt && <span className="text-xs text-fg-muted">superseded {h.supersededAt.slice(0, 10)}</span>}
            {h.id === currentId ? (
              <span className="text-xs font-medium text-fg-subtle">viewing</span>
            ) : (
              <Link href={`/admin/projects/${projectId}/valuations/${h.id}`} className="text-xs font-medium text-primary hover:underline">
                open
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

// ─── Revenue vs earned value ─────────────────────────────────────────────────

/**
 * Certified gross is REVENUE (billRate × BOQ and agreed lump-sum revenue). EV is COST earned
 * (the frozen cost build-up). They are different quantities and coincide only at zero margin,
 * so they are labelled separately here and the gap is named as margin earned — EV is never
 * presented as "value of work done".
 */
export function RevenueVsEvPanel({ certifiedGross, ev, ac }: { certifiedGross: number; ev: number; ac: number }) {
  const marginEarned = Math.round((certifiedGross - ev) * 1000) / 1000
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Certified revenue vs earned value</h2>
      <div className="grid gap-3 sm:grid-cols-4">
        <Figure label="Certified gross (revenue)" value={bhd(certifiedGross)} sub="latest certified cumulative" />
        <Figure label="Earned value (cost)" value={bhd(ev)} sub="cost-weighted, from 6C" />
        <Figure label="Actual cost" value={bhd(ac)} sub="approval-time snapshot" />
        <Figure label="Margin earned" value={bhd(marginEarned)} tone={marginEarned < 0 ? 'danger' : undefined} sub="certified − earned value" />
      </div>
      <p className="text-xs text-fg-subtle">
        These are different quantities, not two views of one number: earned value is the budgeted <em>cost</em> of the work
        done, the certificate is the <em>revenue</em> billed for it. They only coincide at zero margin.
      </p>
    </section>
  )
}

// ─── Bits ────────────────────────────────────────────────────────────────────

function Figure({ label, value, sub, tone, strong }: { label: string; value: string; sub?: string; tone?: 'danger'; strong?: boolean }) {
  return (
    <div className={`rounded-lg border bg-surface p-4 ${strong ? 'border-primary' : 'border-border'}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${tone === 'danger' ? 'text-danger' : 'text-fg'}`}>{value}</p>
      {sub && <p className="text-xs text-fg-subtle">{sub}</p>}
    </div>
  )
}

function SplitRow({ label, value }: { label: string; value: string }) {
  return (
    <TR>
      <TD>{label}</TD>
      <TD className="text-right tabular-nums">{value}</TD>
    </TR>
  )
}
