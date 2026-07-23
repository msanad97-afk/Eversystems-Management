import type { CashCategory, CashDirection, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { round } from '@/lib/budget'
import { MONEY_DP } from '@/lib/evm'
import { loadProjectMoney } from '@/lib/money.server'
import { loadCertifiedRevisionsByPeriod } from '@/lib/valuation.server'
import {
  accountBalances, sumBalances, directionFor, paymentState, ageBucket, buildForecast, unscheduledPayables, monthKeyOf,
  type AccountBalances, type PaymentState, type AgeBucket, type ForecastInflow, type ForecastOutflow, type ForecastRow,
} from '@/lib/cash'

const n = (v: unknown): number => (v == null ? 0 : Number(v))
const day = (d: Date | null): string | null => (d == null ? null : d.toISOString().slice(0, 10))

// ─── Accounts & balances ──────────────────────────────────────────────────────

export interface AccountView extends AccountBalances {
  id: string
  name: string
  currency: string
  openingBalance: number
  openingDate: string
  isActive: boolean
}
export interface CashPosition {
  accounts: AccountView[]
  totals: AccountBalances
}

/** Every account with its cleared + projected balances, and the company totals. */
export async function loadCashPosition(): Promise<CashPosition> {
  const accounts = await prisma.bankAccount.findMany({
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    select: {
      id: true, name: true, currency: true, openingBalance: true, openingDate: true, isActive: true,
      transactions: { select: { direction: true, amount: true, clearedAt: true } },
    },
  })

  const views: AccountView[] = accounts.map((a) => {
    const bal = accountBalances(
      n(a.openingBalance),
      a.transactions.map((t) => ({ direction: t.direction, amount: n(t.amount), cleared: t.clearedAt != null })),
    )
    return {
      id: a.id, name: a.name, currency: a.currency, openingBalance: n(a.openingBalance),
      openingDate: a.openingDate.toISOString().slice(0, 10), isActive: a.isActive, ...bal,
    }
  })

  return { accounts: views, totals: sumBalances(views) }
}

// ─── Receivables (the correctness core) ────────────────────────────────────────

export interface ReceivableRow {
  periodMonth: string
  projectId: string
  projectName: string
  valuationId: string // the current certified revision
  valuationCode: string
  revisionNumber: number
  netPayable: number
  receiptsTotal: number
  outstanding: number
  expectedReceipt: string | null
  invoicedAt: string | null
  paymentState: PaymentState
  ageBucket: AgeBucket
}

/**
 * `receiptsTotal` per PERIOD. Receipts carry a `valuationId` — a specific revision — but a
 * receipt paid against a since-superseded revision is still money received for that period.
 * So we map every revision id of the project(s) to its period and sum IN receipts by period,
 * never per revision. This is the §6E.4 rule: outstanding = live netPayable − all period receipts.
 */
async function receiptsByPeriod(projectIds: string[]): Promise<Map<string, number>> {
  if (projectIds.length === 0) return new Map()

  // valuationId → periodMonth key, across ALL revisions (live and superseded).
  const revisions = await prisma.valuation.findMany({
    where: { projectId: { in: projectIds } },
    select: { id: true, projectId: true, periodMonth: true },
  })
  const periodOf = new Map<string, string>() // valuationId → "projectId|periodKey"
  for (const r of revisions) periodOf.set(r.id, `${r.projectId}|${r.periodMonth.toISOString().slice(0, 10)}`)

  const receipts = await prisma.cashTransaction.findMany({
    where: { direction: 'IN', valuationId: { in: [...periodOf.keys()] } },
    select: { valuationId: true, amount: true },
  })
  const byPeriod = new Map<string, number>()
  for (const t of receipts) {
    const key = periodOf.get(t.valuationId!)
    if (!key) continue
    byPeriod.set(key, round((byPeriod.get(key) ?? 0) + n(t.amount), MONEY_DP))
  }
  return byPeriod
}

/**
 * Receivables for one project or the whole company, one row per period at the CURRENT
 * certified revision. Only periods with outstanding ≠ 0 (or a non-zero receipt) surface, so a
 * fully-settled period drops off. Rows are newest-period-first.
 */
export async function loadReceivables(opts: { projectId?: string; today: Date }): Promise<ReceivableRow[]> {
  const certified = await loadCertifiedRevisionsByPeriod(prisma, opts.projectId ? { projectId: opts.projectId } : {})
  if (certified.length === 0) return []

  const projectIds = [...new Set(certified.map((c) => c.projectId))]
  const [receipts, projects] = await Promise.all([
    receiptsByPeriod(projectIds),
    prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } }),
  ])
  const nameOf = new Map(projects.map((p) => [p.id, p.name]))

  const rows: ReceivableRow[] = certified.map((c) => {
    const periodKey = c.periodMonth.toISOString().slice(0, 10)
    const receiptsTotal = receipts.get(`${c.projectId}|${periodKey}`) ?? 0
    const outstanding = round(c.netPayable - receiptsTotal, MONEY_DP)
    return {
      periodMonth: periodKey,
      projectId: c.projectId,
      projectName: nameOf.get(c.projectId) ?? '—',
      valuationId: c.id,
      valuationCode: c.valuationCode,
      revisionNumber: c.revisionNumber,
      netPayable: c.netPayable,
      receiptsTotal,
      outstanding,
      expectedReceipt: day(c.expectedReceipt),
      invoicedAt: day(c.invoicedAt),
      paymentState: paymentState(c.netPayable, receiptsTotal, c.invoicedAt),
      ageBucket: ageBucket(c.expectedReceipt, opts.today),
    }
  })

  // Only periods with something still to collect (or over-collected). A fully-settled period
  // — outstanding exactly 0 — drops off, matching the §6E.4 ageing rule; OVERPAID (< 0) stays.
  return rows
    .filter((r) => r.outstanding !== 0)
    .sort((a, b) => b.periodMonth.localeCompare(a.periodMonth))
}

// ─── Forecast (inflows only) ────────────────────────────────────────────────────

export interface CashForecast {
  months: ForecastRow[] // Phase 7: inflow + outflow + net + running balance per month
  clearedBalance: number
  unscheduledPayables: number // Σ outstanding of payables with NO due date — reported separately
}

/**
 * Outstanding expense payables: amount − Σ matched payments (the 6E `expenseId` FK). Fully-paid
 * expenses (outstanding ≤ 0) drop out. `dueDate` is the cash-timing field; a null due date is
 * unscheduled and handled by the forecast builder / `unscheduledPayables`, never bucketed.
 */
async function loadExpensePayables(): Promise<ForecastOutflow[]> {
  const expenses = await prisma.expense.findMany({
    select: { amount: true, dueDate: true, payments: { where: { direction: 'OUT' }, select: { amount: true } } },
  })
  return expenses
    .map((e) => {
      const paid = e.payments.reduce((s, p) => s + n(p.amount), 0)
      return { dueDate: e.dueDate, outstanding: round(n(e.amount) - paid, MONEY_DP) }
    })
    .filter((o) => o.outstanding > 0)
}

export async function loadForecast(months: number, today: Date): Promise<CashForecast> {
  const [receivables, position, payables] = await Promise.all([
    loadReceivables({ today }),
    loadCashPosition(),
    loadExpensePayables(),
  ])
  const inflows: ForecastInflow[] = receivables
    .filter((r) => r.outstanding > 0)
    .map((r) => ({ expectedReceipt: r.expectedReceipt ? new Date(`${r.expectedReceipt}T00:00:00.000Z`) : null, outstanding: r.outstanding }))

  return {
    months: buildForecast(inflows, payables, position.totals.clearedBalance, monthKeyOf(today), months),
    clearedBalance: position.totals.clearedBalance,
    unscheduledPayables: unscheduledPayables(payables),
  }
}

// ─── Advance block (per project) ────────────────────────────────────────────────

export interface AdvanceBlock {
  advancePct: number
  expected: number // advancePct × bottom-up contract value
  received: number // Σ ADVANCE_PAYMENT inflows for the project
  recovered: number // Σ advanceRecovery across current certified revisions
  outstanding: number // received − recovered (advance still to recover through future certs)
}

/** Null when the project has no advancePct — the UI hides the block entirely. */
export async function loadAdvanceBlock(projectId: string): Promise<AdvanceBlock | null> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { advancePct: true } })
  if (!project || project.advancePct == null) return null
  const advancePct = n(project.advancePct)

  const [money, certified, received] = await Promise.all([
    loadProjectMoney(projectId),
    loadCertifiedRevisionsByPeriod(prisma, { projectId }),
    prisma.cashTransaction.aggregate({
      where: { projectId, direction: 'IN', category: 'ADVANCE_PAYMENT' },
      _sum: { amount: true },
    }),
  ])

  const contractValue = money?.contractValue ?? 0
  const expected = round((advancePct / 100) * contractValue, MONEY_DP)
  const recovered = round(certified.reduce((s, c) => s + c.advanceRecovery, 0), MONEY_DP)
  const receivedTotal = n(received._sum.amount)
  return {
    advancePct,
    expected,
    received: receivedTotal,
    recovered,
    outstanding: round(receivedTotal - recovered, MONEY_DP),
  }
}

// ─── Ledger listing ──────────────────────────────────────────────────────────

export interface LedgerFilters {
  accountId?: string
  projectId?: string
  direction?: CashDirection
  category?: CashCategory
  from?: Date
  to?: Date
  cleared?: boolean // true = cleared only, false = pending only
  matched?: boolean // true = has valuation or expense, false = neither
  limit: number
  offset: number
}

export interface LedgerRow {
  id: string
  txnDate: string
  direction: CashDirection
  category: CashCategory
  amount: number
  description: string
  accountId: string
  accountName: string
  projectId: string | null
  projectName: string | null
  valuationId: string | null
  valuationCode: string | null
  expenseId: string | null
  clearedAt: string | null
  createdAt: string
}

export async function loadLedger(f: LedgerFilters): Promise<{ transactions: LedgerRow[]; total: number }> {
  const where: Prisma.CashTransactionWhereInput = {
    ...(f.accountId ? { accountId: f.accountId } : {}),
    ...(f.projectId ? { projectId: f.projectId } : {}),
    ...(f.direction ? { direction: f.direction } : {}),
    ...(f.category ? { category: f.category } : {}),
    ...(f.from || f.to ? { txnDate: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
    ...(f.cleared === true ? { clearedAt: { not: null } } : f.cleared === false ? { clearedAt: null } : {}),
    ...(f.matched === true ? { OR: [{ valuationId: { not: null } }, { expenseId: { not: null } }] }
      : f.matched === false ? { valuationId: null, expenseId: null } : {}),
  }

  const [rows, total] = await Promise.all([
    prisma.cashTransaction.findMany({
      where,
      orderBy: [{ txnDate: 'desc' }, { createdAt: 'desc' }],
      skip: f.offset,
      take: f.limit,
      select: {
        id: true, txnDate: true, direction: true, category: true, amount: true, description: true,
        accountId: true, projectId: true, valuationId: true, expenseId: true, clearedAt: true, createdAt: true,
        account: { select: { name: true } },
        project: { select: { name: true } },
        valuation: { select: { valuationCode: true } },
      },
    }),
    prisma.cashTransaction.count({ where }),
  ])

  return {
    transactions: rows.map((t) => ({
      id: t.id,
      txnDate: t.txnDate.toISOString().slice(0, 10),
      direction: t.direction,
      category: t.category,
      amount: n(t.amount),
      description: t.description,
      accountId: t.accountId,
      accountName: t.account.name,
      projectId: t.projectId,
      projectName: t.project?.name ?? null,
      valuationId: t.valuationId,
      valuationCode: t.valuation?.valuationCode ?? null,
      expenseId: t.expenseId,
      clearedAt: day(t.clearedAt),
      createdAt: t.createdAt.toISOString(),
    })),
    total,
  }
}

// ─── Shared validation for the transaction write path ──────────────────────────

export interface TxnMatchContext {
  periodOutstandingBefore: number // outstanding on the matched valuation's period, before this txn
  periodNetPayable: number
}

/**
 * Resolve a valuation match: it must be CERTIFIED, and its period's outstanding is returned so
 * the route can apply the over-payment guard. projectId is taken FROM the valuation, never
 * free-typed. Returns null-ish errors as a discriminated result.
 */
export async function resolveValuationMatch(
  valuationId: string,
  today: Date,
): Promise<{ ok: true; projectId: string; ctx: TxnMatchContext } | { ok: false; error: string }> {
  const v = await prisma.valuation.findUnique({
    where: { id: valuationId },
    select: { id: true, projectId: true, status: true, periodMonth: true },
  })
  if (!v) return { ok: false, error: 'Matched valuation not found.' }
  if (v.status !== 'CERTIFIED') return { ok: false, error: `A cash receipt can only match a CERTIFIED valuation (this one is ${v.status}).` }

  // The period's live-certified net payable and current receipts → outstanding before this txn.
  const receivables = await loadReceivables({ projectId: v.projectId, today })
  const periodKey = v.periodMonth.toISOString().slice(0, 10)
  const row = receivables.find((r) => r.periodMonth === periodKey)
  const periodNetPayable = row?.netPayable ?? 0
  const periodOutstandingBefore = row?.outstanding ?? periodNetPayable
  return { ok: true, projectId: v.projectId, ctx: { periodOutstandingBefore, periodNetPayable } }
}

export { directionFor }
