import type { ProjectCostPerformance } from '@/lib/cost.server'
import type { Light } from '@/lib/actuals'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { BackfillCostsButton } from '@/components/admin/BackfillCostsButton'

const DOT: Record<Light, string> = { green: 'bg-success', amber: 'bg-warning', red: 'bg-danger', none: 'bg-fg-subtle/40' }
const TEXT: Record<Light, string> = { green: 'text-success', amber: 'text-warning', red: 'text-danger', none: 'text-fg-subtle' }

const bhd = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })
const LightDot = ({ light }: { light: Light }) => <span className={`inline-block h-2.5 w-2.5 rounded-full ${DOT[light]}`} aria-hidden />

/**
 * Phase 6B — Actual Cost vs the Phase 6A budget. ADMIN-only.
 * Two data-quality signals are deliberately loud: work costed at ZERO (unpriced resources),
 * which would flatter cost performance, and APPROXIMATED cost from the backfill action.
 */
export function ActualCostPanel({ cost, projectId }: { cost: ProjectCostPerformance; projectId: string }) {
  const nothing = cost.actualCost === 0 && cost.bac === 0

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Actual cost</h2>
          <p className="text-xs text-fg-subtle">
            Costed at the rate in force when each report was approved, plus eligible project expenses. Approved reports only.
          </p>
        </div>
        <BackfillCostsButton projectId={projectId} />
      </div>

      {/* LOUD: real work costed at zero would understate AC and inflate cost performance. */}
      {cost.unpriced.length > 0 && (
        <div className="rounded-lg border border-danger bg-danger-bg p-4">
          <p className="text-sm font-semibold text-danger">
            {cost.unpriced.length} approved {cost.unpriced.length === 1 ? 'entry was' : 'entries were'} costed at zero — actual cost is understated
          </p>
          <p className="mt-1 text-xs text-danger">
            These resources had no rate when the report was approved, so real work carries no cost. Cost performance below looks better than it is.
          </p>
          <ul className="mt-2 space-y-0.5 text-sm text-danger">
            {cost.unpriced.slice(0, 10).map((u, i) => (
              <li key={i}>
                <span className="font-medium">{u.resourceName}</span> ({u.kind === 'LABOUR' ? 'labour' : 'material'})
                <span className="text-fg-muted"> · {u.activityName} · {u.reportCode} {u.reportDate}</span>
              </li>
            ))}
            {cost.unpriced.length > 10 && <li className="text-fg-muted">…and {cost.unpriced.length - 10} more</li>}
          </ul>
        </div>
      )}

      {/* LOUD: backfilled cost is an estimate, never a measured cost. */}
      {cost.hasApproximations && (
        <div className="rounded-lg border border-warning bg-warning-bg px-4 py-3 text-sm text-warning">
          <span className="font-semibold">BHD {bhd(cost.approximatedCost)} of this actual cost is an APPROXIMATION.</span>{' '}
          It was backfilled at today&apos;s rates for reports approved before costs were captured — not the rates in force at approval.
          Rows below are marked <Badge tone="warning">approx</Badge>.
        </div>
      )}

      {nothing ? (
        <EmptyState title="No actual cost yet" description="Approve a daily report, or record a project expense, to build actual cost." />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Card label="Budget (BAC)" value={`BHD ${bhd(cost.bac)}`} />
            <Card label="Field cost" value={`BHD ${bhd(cost.fieldCost)}`} sub="from approved reports" />
            <Card label="Expenses" value={`BHD ${bhd(cost.expenseCost)}`} sub="eligible, project-allocated" />
            <div className="rounded-lg border border-border bg-surface p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Actual cost</p>
              <p className="mt-1 flex items-center gap-2 text-lg font-semibold tabular-nums text-fg">
                <LightDot light={cost.light} />
                BHD {bhd(cost.actualCost)}
              </p>
              <p className={`text-xs ${TEXT[cost.light]}`}>
                {cost.consumedPct == null ? 'no budget' : `${cost.consumedPct}% of budget · variance ${bhd(cost.variance)}`}
              </p>
            </div>
          </div>

          {/* Per-activity: field cost only — expenses have no activity link. */}
          <div className="rounded-lg border border-border bg-surface">
            <div className="border-b border-border px-4 py-2">
              <p className="text-sm font-semibold text-fg">By activity <span className="font-normal text-fg-subtle">(field cost — expenses are project-level, below)</span></p>
            </div>
            <Table>
              <THead>
                <TR>
                  <TH>Activity</TH><TH className="text-right">Budget</TH><TH className="text-right">Labour</TH>
                  <TH className="text-right">Material</TH><TH className="text-right">Actual</TH><TH className="text-right">%</TH><TH></TH>
                </TR>
              </THead>
              <TBody>
                {cost.activities.map((a) => (
                  <TR key={a.activityId}>
                    <TD>
                      {a.ref ? `${a.ref} · ` : ''}{a.name}
                      <span className="text-xs text-fg-subtle"> · {a.assetName}</span>
                      {a.approximated && <Badge tone="warning" className="ml-2">approx</Badge>}
                    </TD>
                    <TD className="text-right tabular-nums">{bhd(a.budgetCost)}</TD>
                    <TD className="text-right tabular-nums">{bhd(a.labourCost)}</TD>
                    <TD className="text-right tabular-nums">{bhd(a.materialCost)}</TD>
                    <TD className="text-right tabular-nums">{bhd(a.actualCost)}</TD>
                    <TD className={`text-right tabular-nums ${TEXT[a.light]}`}>{a.consumedPct == null ? '—' : `${a.consumedPct}%`}</TD>
                    <TD><LightDot light={a.light} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>

          {/* Indirect / off-report costs */}
          {(cost.expenses.eligible.length > 0 || cost.expenses.excluded.length > 0) && (
            <div className="rounded-lg border border-border bg-surface">
              <div className="border-b border-border px-4 py-2">
                <p className="text-sm font-semibold text-fg">Indirect &amp; off-report costs</p>
              </div>
              <Table>
                <THead>
                  <TR><TH>Date</TH><TH>Category</TH><TH>Description</TH><TH className="text-right">Amount</TH><TH>In actual cost?</TH></TR>
                </THead>
                <TBody>
                  {[...cost.expenses.eligible, ...cost.expenses.excluded].map((e) => (
                    <TR key={e.id}>
                      <TD className="whitespace-nowrap text-fg-muted">{e.expenseDate}</TD>
                      <TD className="text-xs">{e.category.replace(/_/g, ' ').toLowerCase()}</TD>
                      <TD>{e.description}{e.vendor ? <span className="text-fg-subtle"> · {e.vendor}</span> : null}</TD>
                      <TD className="text-right tabular-nums">{bhd(e.amount)}</TD>
                      <TD>
                        {e.eligible ? (
                          <Badge tone="success">counted</Badge>
                        ) : (
                          <span className="flex flex-wrap items-center gap-1">
                            <Badge tone="neutral">excluded</Badge>
                            <span className="text-xs text-fg-subtle">{e.exclusionReason}</span>
                          </span>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <p className="px-4 py-2 text-xs text-fg-subtle">
                Counted BHD {bhd(cost.expenses.eligibleTotal)} · excluded BHD {bhd(cost.expenses.excludedTotal)}
              </p>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-fg">{value}</p>
      {sub && <p className="text-xs text-fg-subtle">{sub}</p>}
    </div>
  )
}
