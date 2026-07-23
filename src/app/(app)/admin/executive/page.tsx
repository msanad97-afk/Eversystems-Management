import { requireAdminPage } from '@/lib/auth/permissions'
import { loadExecutiveDashboard } from '@/lib/executive.server'
import { CashHeadlinePanel, AgeingSummaryPanel, AttentionListPanel, PortfolioTable } from '@/components/admin/ExecutivePanels'
import { RunningCashChart } from '@/components/admin/RunningCashChart'

export const dynamic = 'force-dynamic'

const MONTHS = 6
const utcDay = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) }

/** Executive dashboard — the money view. ADMIN-only; the report/operations dashboard at /admin stays. */
export default async function ExecutivePage() {
  await requireAdminPage()
  const data = await loadExecutiveDashboard(MONTHS, utcDay())

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-fg">Executive</h1>
        <p className="text-sm text-fg-subtle">Company cash, portfolio performance and what needs attention · as of {data.asOf}</p>
      </div>

      <CashHeadlinePanel cash={data.cash} months={data.months} />

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Running cash ({data.months} months)</h2>
        </div>
        {data.goesNegativeMonth && (
          <div className="rounded-lg border border-danger bg-danger-bg px-4 py-2 text-sm font-medium text-danger">
            Projected cash goes negative in {new Date(`${data.goesNegativeMonth}T00:00:00.000Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}.
          </div>
        )}
        <RunningCashChart months={data.forecast} />
      </section>

      <AttentionListPanel items={data.attention} more={data.attentionMore} />

      <PortfolioTable rows={data.portfolio} totals={data.totals} />

      <AgeingSummaryPanel ageing={data.ageing} />
    </div>
  )
}
