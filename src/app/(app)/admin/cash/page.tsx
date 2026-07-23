import type { CashCategory, CashDirection } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAdminPage } from '@/lib/auth/permissions'
import { loadCashPosition, loadReceivables, loadForecast, loadLedger } from '@/lib/cash.server'
import { AccountsStrip, ReceivablesTable, ForecastPanel } from '@/components/admin/CashPanels'
import { CashManager } from '@/components/admin/CashManager'
import { CashLedgerFilters } from '@/components/admin/CashLedgerFilters'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50
const utcDay = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) }
const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v)
const parseDay = (v: string | undefined): Date | undefined => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00.000Z`) : undefined)

/** Company Cash — ADMIN-only; `requireAdminPage` redirects everyone else. */
export default async function CashPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireAdminPage()
  const today = utcDay()

  // Ledger filters from the URL (every one maps to a filter loadLedger already supports).
  const page = Math.max(1, Number(one(searchParams.page)) || 1)
  const dir = one(searchParams.direction)
  const cleared = one(searchParams.cleared)
  const matched = one(searchParams.matched)
  const ledgerFilters = {
    accountId: one(searchParams.accountId),
    projectId: one(searchParams.projectId),
    direction: dir === 'IN' || dir === 'OUT' ? (dir as CashDirection) : undefined,
    category: one(searchParams.category) as CashCategory | undefined,
    from: parseDay(one(searchParams.from)),
    to: parseDay(one(searchParams.to)),
    cleared: cleared === 'true' ? true : cleared === 'false' ? false : undefined,
    matched: matched === 'true' ? true : matched === 'false' ? false : undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  }

  const [position, receivables, forecast, ledger, projects] = await Promise.all([
    loadCashPosition(),
    loadReceivables({ today }),
    loadForecast(6, today),
    loadLedger(ledgerFilters),
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

      <CashLedgerFilters
        accounts={position.accounts.map((a) => ({ id: a.id, name: a.name }))}
        projects={projects}
        total={ledger.total}
        page={page}
        pageSize={PAGE_SIZE}
        shown={ledger.transactions.length}
      />

      <CashManager
        accounts={position.accounts.filter((a) => a.isActive).map((a) => ({ id: a.id, name: a.name, currency: a.currency }))}
        projects={projects}
        ledger={ledger.transactions}
      />
    </div>
  )
}
