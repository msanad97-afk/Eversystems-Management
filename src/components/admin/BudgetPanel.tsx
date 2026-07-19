import type { ProjectBudget, BudgetTotals } from '@/lib/budget'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'

function bhd(n: number): string {
  return `BHD ${n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`
}
function num(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 })
}
function totalManHours(t: BudgetTotals): number {
  return t.manpower.reduce((s, m) => s + m.hours, 0)
}

function MeasuredTables({ totals }: { totals: BudgetTotals }) {
  const hasMeasured = totals.manpower.length > 0 || totals.materials.length > 0
  if (!hasMeasured) return <p className="text-sm text-fg-subtle">No measured budget.</p>
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {totals.manpower.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Labour (budget hours)</p>
          <Table>
            <THead><TR><TH>Trade</TH><TH className="text-right">Hours</TH></TR></THead>
            <TBody>
              {totals.manpower.map((m) => (
                <TR key={m.laborCategoryId}><TD>{m.laborCategoryName}</TD><TD className="text-right tabular-nums">{num(m.hours)}</TD></TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
      {totals.materials.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Materials (budget qty)</p>
          <Table>
            <THead><TR><TH>Material</TH><TH className="text-right">Qty</TH><TH>Unit</TH></TR></THead>
            <TBody>
              {totals.materials.map((m) => (
                <TR key={m.materialId}>
                  <TD>{m.materialName}</TD>
                  <TD className="text-right tabular-nums">{num(m.quantity)}</TD>
                  <TD className="text-fg-muted">{m.materialUnit}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </div>
  )
}

/**
 * Plan (budget) view — Rev 2 Phase C1. Two scorecards kept SEPARATE until Phase 6: a
 * measured side (labour hours by trade + material quantities, derived as rate × placed
 * quantity) and a lumpsum side (fixed BHD). Actuals/variance arrive in Phase C2.
 */
export function BudgetPanel({ budget }: { budget: ProjectBudget }) {
  const empty =
    budget.totals.manpower.length === 0 &&
    budget.totals.materials.length === 0 &&
    budget.totals.lumpsumBhd === 0

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Budget (plan)</h2>
        <p className="text-xs text-fg-subtle">
          Measured (hours &amp; quantities) and lumpsum (BHD) are tracked separately until cost rates arrive in Phase 6.
        </p>
      </div>

      {empty ? (
        <EmptyState
          title="No budget yet"
          description="Place a catalog activity with rates, or add a lumpsum line, to build a budget."
        />
      ) : (
        <>
          {/* Project rollup */}
          <div className="grid gap-3 sm:grid-cols-3">
            <Card label="Budget man-hours" value={num(totalManHours(budget.totals))} />
            <Card label="Material lines" value={String(budget.totals.materials.length)} />
            <Card label="Lumpsum total" value={bhd(budget.totals.lumpsumBhd)} />
          </div>

          <div className="rounded-lg border border-border bg-surface p-4">
            <p className="mb-2 text-sm font-medium text-fg">Project totals</p>
            <MeasuredTables totals={budget.totals} />
          </div>

          {/* Per-asset / per-activity breakdown */}
          <div className="space-y-3">
            {budget.assets.map((asset) => (
              <div key={asset.assetId} className="rounded-lg border border-border bg-surface">
                <div className="border-b border-border px-4 py-2">
                  <p className="text-sm font-semibold text-fg">{asset.assetName}</p>
                </div>
                <div className="divide-y divide-border">
                  {asset.activities.length === 0 && <p className="px-4 py-3 text-sm text-fg-subtle">No activities.</p>}
                  {asset.activities.map((a) => (
                    <div key={a.activityId} className="space-y-2 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-fg">{a.ref ? `${a.ref} · ` : ''}{a.name}</span>
                        <Badge tone={a.type === 'LUMPSUM' ? 'warning' : 'neutral'}>{a.type === 'LUMPSUM' ? 'lumpsum' : 'measured'}</Badge>
                        {a.type === 'MEASURED' && a.unit && (
                          <span className="text-xs text-fg-subtle">BOQ {num(a.boqQuantity)} {a.unit}</span>
                        )}
                      </div>
                      {a.type === 'LUMPSUM' ? (
                        <p className="text-sm tabular-nums text-fg">{bhd(a.totals.lumpsumBhd)}</p>
                      ) : (
                        <MeasuredTables totals={a.totals} />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-fg">{value}</p>
    </div>
  )
}
