import { prisma } from '@/lib/prisma'
import { requireAdminPage } from '@/lib/auth/permissions'
import { loadCashPosition, loadReceivables, loadForecast, loadLedger } from '@/lib/cash.server'
import { AccountsStrip, ReceivablesTable, ForecastPanel } from '@/components/admin/CashPanels'
import { CashManager } from '@/components/admin/CashManager'

export const dynamic = 'force-dynamic'

const utcDay = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) }

/** Company Cash — ADMIN-only; `requireAdminPage` redirects everyone else. */
export default async function CashPage() {
  await requireAdminPage()
  const today = utcDay()

  const [position, receivables, forecast, ledger, projects] = await Promise.all([
    loadCashPosition(),
    loadReceivables({ today }),
    loadForecast(6, today),
    loadLedger({ limit: 50, offset: 0 }),
    prisma.project.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-fg">Cash</h1>
        <p className="text-sm text-fg-subtle">Bank position, receivables and inflow forecast · as of {today.toISOString().slice(0, 10)}</p>
      </div>

      <AccountsStrip position={position} />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Receivables &amp; ageing</h2>
        <ReceivablesTable rows={receivables} showProject />
      </section>

      <ForecastPanel forecast={forecast} />

      <CashManager
        accounts={position.accounts.filter((a) => a.isActive).map((a) => ({ id: a.id, name: a.name, currency: a.currency }))}
        projects={projects}
        ledger={ledger.transactions}
        total={ledger.total}
      />
    </div>
  )
}
