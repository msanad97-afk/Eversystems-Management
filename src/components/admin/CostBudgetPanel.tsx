import type { ProjectMoney, CostSource } from '@/lib/money'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'

function bhd(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })
}

const SOURCE_LABEL: Record<CostSource, string> = {
  BUILD_UP: 'build-up',
  RATE_FALLBACK: 'cost rate',
  LUMPSUM: 'lumpsum',
  MIXED: 'mixed',
  NONE: 'unpriced',
}

/**
 * Phase 6A — the single BHD cost budget (BAC), contract value and margin, priced from the
 * cost rates frozen at placement. ADMIN-only. Unpriced resources are surfaced loudly at the
 * top because they silently understate the budget until fixed.
 */
export function CostBudgetPanel({ money }: { money: ProjectMoney }) {
  const empty = money.assets.every((a) => a.activities.length === 0)

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Cost budget &amp; contract value</h2>
        <p className="text-xs text-fg-subtle">
          Priced from the cost rates frozen when each activity was placed — editing a global catalog rate never moves this.
        </p>
      </div>

      {/* Loud data-quality warning: unpriced resources understate the budget. */}
      {money.unpriced.length > 0 && (
        <div className="rounded-lg border border-danger bg-danger-bg p-4">
          <p className="text-sm font-semibold text-danger">
            {money.unpriced.length} unpriced {money.unpriced.length === 1 ? 'item' : 'items'} — the cost budget below is understated
          </p>
          <p className="mt-1 text-xs text-danger">
            These carry no rate, so they contribute 0 to the budget and are excluded from actual cost until priced.
          </p>
          <ul className="mt-2 space-y-0.5 text-sm text-danger">
            {money.unpriced.slice(0, 12).map((u, i) => (
              <li key={i}>
                <span className="font-medium">{u.resourceName}</span>
                {' — '}
                {u.kind === 'LABOUR' ? 'no hourly rate' : u.kind === 'MATERIAL' ? 'no unit rate' : u.kind === 'ACTIVITY_COST' ? 'no cost rate or build-up' : 'no bill rate'}
                <span className="text-fg-muted"> · {u.activityName}</span>
              </li>
            ))}
            {money.unpriced.length > 12 && <li className="text-fg-muted">…and {money.unpriced.length - 12} more</li>}
          </ul>
        </div>
      )}

      {/* Header cross-check: bottom-up is authoritative. */}
      {money.header.diverged && (
        <div className="rounded-lg border border-warning bg-warning-bg px-4 py-3 text-sm text-warning">
          <span className="font-semibold">Header figures don&apos;t match the build-up.</span>{' '}
          {money.header.costDivergence != null && money.header.costDivergence !== 0 && (
            <>Budget cost header {bhd(money.header.budgetCost ?? 0)} vs build-up {bhd(money.bac)} ({money.header.costDivergence > 0 ? '+' : ''}{bhd(money.header.costDivergence)}). </>
          )}
          {money.header.contractDivergence != null && money.header.contractDivergence !== 0 && (
            <>Contract header {bhd(money.header.contractValue ?? 0)} vs build-up {bhd(money.contractValue)} ({money.header.contractDivergence > 0 ? '+' : ''}{bhd(money.header.contractDivergence)}).</>
          )}{' '}
          The build-up is authoritative.
        </div>
      )}

      {empty ? (
        <EmptyState title="No priced scope yet" description="Place activities and set cost/bill rates to build a cost budget." />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card label="Cost budget (BAC)" value={`BHD ${bhd(money.bac)}`} />
            <Card label="Contract value" value={`BHD ${bhd(money.contractValue)}`} />
            <Card
              label="Margin"
              value={`BHD ${bhd(money.margin)}`}
              sub={money.marginPct == null ? undefined : `${money.marginPct}% of contract`}
              tone={money.margin < 0 ? 'danger' : undefined}
            />
          </div>

          <div className="space-y-3">
            {money.assets.map((asset) => (
              <div key={asset.assetId} className="rounded-lg border border-border bg-surface">
                <div className="flex items-center justify-between border-b border-border px-4 py-2">
                  <p className="text-sm font-semibold text-fg">{asset.assetName}</p>
                  <p className="text-xs tabular-nums text-fg-muted">
                    cost {bhd(asset.costBudget)} · value {bhd(asset.contractValue)}
                  </p>
                </div>
                <Table>
                  <THead>
                    <TR>
                      <TH>Activity</TH><TH>Basis</TH>
                      <TH className="text-right">Cost budget</TH><TH className="text-right">Contract value</TH><TH className="text-right">Margin</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {asset.activities.map((a) => (
                      <TR key={a.activityId}>
                        <TD>{a.ref ? `${a.ref} · ` : ''}{a.name}</TD>
                        <TD>
                          <Badge tone={a.costSource === 'NONE' ? 'danger' : a.costSource === 'LUMPSUM' ? 'warning' : 'neutral'}>
                            {SOURCE_LABEL[a.costSource]}
                          </Badge>
                        </TD>
                        <TD className="text-right tabular-nums">{bhd(a.costBudget)}</TD>
                        <TD className="text-right tabular-nums">{bhd(a.contractValue)}</TD>
                        <TD className={`text-right tabular-nums ${a.margin < 0 ? 'text-danger' : ''}`}>{bhd(a.margin)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

function Card({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'danger' }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${tone === 'danger' ? 'text-danger' : 'text-fg'}`}>{value}</p>
      {sub && <p className="text-xs text-fg-subtle">{sub}</p>}
    </div>
  )
}
