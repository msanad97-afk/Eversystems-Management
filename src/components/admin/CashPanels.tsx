import type { AccountView, CashPosition, ReceivableRow, CashForecast, AdvanceBlock, RetentionBlock } from '@/lib/cash.server'
import type { PaymentState, AgeBucket } from '@/lib/cash'
import { AGE_BUCKET_LABEL } from '@/lib/cash'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'

function bhd(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })
}
function monthLabel(periodMonth: string): string {
  return new Date(`${periodMonth}T00:00:00.000Z`).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

const PAYMENT_TONE: Record<PaymentState, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  UNINVOICED: 'neutral', INVOICED: 'info', PART_PAID: 'warning', PAID: 'success', OVERPAID: 'danger',
}
const AGE_TONE: Record<AgeBucket, 'neutral' | 'info' | 'warning' | 'danger'> = {
  NO_DUE_DATE: 'info', NOT_YET_DUE: 'neutral', DUE_1_30: 'warning', DUE_31_60: 'warning', DUE_61_90: 'danger', DUE_90_PLUS: 'danger',
}

export function PaymentStateBadge({ state }: { state: PaymentState }) {
  return <Badge tone={PAYMENT_TONE[state]}>{state.replace('_', ' ').toLowerCase()}</Badge>
}

// ─── Accounts + balances ───────────────────────────────────────────────────────

export function AccountsStrip({ position }: { position: CashPosition }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Bank accounts</h2>
      {position.accounts.length === 0 ? (
        <EmptyState title="No bank accounts yet" description="Add an account to start recording cash movements." />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {position.accounts.map((a) => <AccountCard key={a.id} account={a} />)}
          </div>
          <div className="rounded-lg border border-primary bg-surface p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Company total</p>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <span className="text-lg font-semibold tabular-nums text-fg">cleared {bhd(position.totals.clearedBalance)}</span>
              <span className="text-sm tabular-nums text-fg-subtle">projected {bhd(position.totals.projectedBalance)}</span>
            </div>
          </div>
        </>
      )}
    </section>
  )
}

function AccountCard({ account: a }: { account: AccountView }) {
  return (
    <div className={`rounded-lg border bg-surface p-4 ${a.isActive ? 'border-border' : 'border-dashed border-border-strong opacity-70'}`}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-fg">{a.name}</p>
        <span className="mono text-xs text-fg-subtle">{a.currency}</span>
      </div>
      <p className="mt-2 text-lg font-semibold tabular-nums text-fg">{bhd(a.clearedBalance)}<span className="ml-1 text-xs font-normal text-fg-subtle">cleared</span></p>
      <p className="text-xs tabular-nums text-fg-subtle">
        projected {bhd(a.projectedBalance)}
        {(a.pendingIn > 0 || a.pendingOut > 0) && <> · pending +{bhd(a.pendingIn)} / −{bhd(a.pendingOut)}</>}
      </p>
      {!a.isActive && <p className="mt-1 text-xs text-fg-muted">inactive</p>}
    </div>
  )
}

// ─── Receivables / ageing ──────────────────────────────────────────────────────

export function ReceivablesTable({ rows, showProject }: { rows: ReceivableRow[]; showProject: boolean }) {
  if (rows.length === 0) {
    return <EmptyState title="Nothing outstanding" description="Certified valuations with money still to collect appear here." />
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <Table>
        <THead>
          <TR>
            {showProject && <TH>Project</TH>}
            <TH>Period</TH><TH>Certificate</TH>
            <TH className="text-right">Net payable</TH><TH className="text-right">Received</TH><TH className="text-right">Outstanding</TH>
            <TH>Expected</TH><TH>Age</TH><TH>State</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.valuationId}>
              {showProject && <TD>{r.projectName}</TD>}
              <TD>{monthLabel(r.periodMonth)}</TD>
              <TD>
                <span className="mono text-xs">{r.valuationCode}</span>
                {r.revisionNumber > 0 && <Badge tone="warning" className="ml-2">rev {r.revisionNumber}</Badge>}
              </TD>
              <TD className="text-right tabular-nums">{bhd(r.netPayable)}</TD>
              <TD className="text-right tabular-nums">{bhd(r.receiptsTotal)}</TD>
              <TD className={`text-right font-medium tabular-nums ${r.outstanding < 0 ? 'text-danger' : ''}`}>{bhd(r.outstanding)}</TD>
              <TD className="text-fg-muted">{r.expectedReceipt ?? '—'}</TD>
              <TD><Badge tone={AGE_TONE[r.ageBucket]}>{AGE_BUCKET_LABEL[r.ageBucket]}</Badge></TD>
              <TD><PaymentStateBadge state={r.paymentState} /></TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  )
}

// ─── Inflow forecast ───────────────────────────────────────────────────────────

export function ForecastPanel({ forecast }: { forecast: CashForecast }) {
  const totalIn = forecast.months.reduce((s, m) => s + m.projectedInflow, 0)
  const totalOut = forecast.months.reduce((s, m) => s + m.projectedOutflow, 0)
  // The single most useful number: the first month the running balance goes negative.
  const goesNegative = forecast.months.find((m) => m.runningBalance < 0)
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Cash forecast</h2>
      {goesNegative && (
        <div className="rounded-lg border border-danger bg-danger-bg px-4 py-2 text-sm font-medium text-danger">
          Projected cash goes negative in {monthLabel(goesNegative.month)} ({bhd(goesNegative.runningBalance)}).
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <Table>
          <THead>
            <TR><TH>Month</TH><TH className="text-right">Inflow</TH><TH className="text-right">Outflow</TH><TH className="text-right">Net</TH><TH className="text-right">Running balance</TH></TR>
          </THead>
          <TBody>
            {forecast.months.map((m) => (
              <TR key={m.month}>
                <TD>{monthLabel(m.month)}</TD>
                <TD className="text-right tabular-nums text-success">{bhd(m.projectedInflow)}</TD>
                <TD className="text-right tabular-nums text-danger">{bhd(m.projectedOutflow)}</TD>
                <TD className={`text-right tabular-nums ${m.projectedNet < 0 ? 'text-danger' : ''}`}>{bhd(m.projectedNet)}</TD>
                <TD className={`text-right font-medium tabular-nums ${m.runningBalance < 0 ? 'text-danger' : 'text-fg'}`}>{bhd(m.runningBalance)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
      <p className="text-sm text-fg-subtle">
        Cleared {bhd(forecast.clearedBalance)} · projected in {bhd(totalIn)} · out {bhd(totalOut)}.
        {forecast.unscheduledPayables > 0 && (
          <> <span className="text-warning">Plus {bhd(forecast.unscheduledPayables)} of unscheduled payables</span> (expenses with no due date) — outstanding but not placed in any month.</>
        )}
        {forecast.unscheduledRetention > 0 && (
          <> <span className="text-warning">Plus {bhd(forecast.unscheduledRetention)} of unscheduled retention</span> (no completion date set) — owed but not yet dated.</>
        )}
      </p>
    </section>
  )
}

// ─── Advance block (per project) ────────────────────────────────────────────────

export function AdvanceBlockPanel({ advance }: { advance: AdvanceBlock }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Advance ({advance.advancePct}%)</h2>
      <div className="grid gap-3 sm:grid-cols-4">
        <Fig label="Expected" value={bhd(advance.expected)} sub="advance % × contract" />
        <Fig label="Received" value={bhd(advance.received)} sub="advance payments in" />
        <Fig label="Recovered" value={bhd(advance.recovered)} sub="via certificates" />
        <Fig label="Outstanding" value={bhd(advance.outstanding)} sub="still to recover" tone={advance.outstanding < 0 ? 'danger' : undefined} />
      </div>
    </section>
  )
}

function Fig({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'danger' }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${tone === 'danger' ? 'text-danger' : 'text-fg'}`}>{value}</p>
      {sub && <p className="text-xs text-fg-subtle">{sub}</p>}
    </div>
  )
}

// ─── Retention block (per project) ──────────────────────────────────────────────

function trancheDue(due: string | null): string {
  return due == null ? 'completion date not set' : due
}

/** `action` is the client "Record retention release" control, injected by the page. */
export function RetentionBlockPanel({ retention, action }: { retention: RetentionBlock; action?: React.ReactNode }) {
  const t1Due = retention.tranche1.due ? retention.tranche1.due.toISOString().slice(0, 10) : null
  const t2Due = retention.tranche2.due ? retention.tranche2.due.toISOString().slice(0, 10) : null
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Retention</h2>
        {action}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Fig label="Held" value={bhd(retention.held)} sub="latest certificate (cumulative)" />
        <Fig label="Released" value={bhd(retention.released)} sub="retention releases in" />
        <Fig label="Outstanding" value={bhd(retention.outstanding)} sub="still to release" tone={retention.outstanding < 0 ? 'danger' : undefined} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Tranche 1 ({retention.firstReleasePct}%)</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-fg">{bhd(retention.tranche1.amount)}</p>
          <p className="text-xs text-fg-subtle">due {trancheDue(t1Due)} · {bhd(retention.tranche1.remaining)} remaining</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Tranche 2 (balance)</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-fg">{bhd(retention.tranche2.amount)}</p>
          <p className="text-xs text-fg-subtle">due {trancheDue(t2Due)} · {bhd(retention.tranche2.remaining)} remaining</p>
        </div>
      </div>
    </section>
  )
}
