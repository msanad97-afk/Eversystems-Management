import { prisma } from '@/lib/prisma'
import { round } from '@/lib/budget'
import { MONEY_DP } from '@/lib/evm'
import { loadPortfolioEvm, type PortfolioRow } from '@/lib/evm.server'
import { loadForecast, loadReceivables, loadAllRetention } from '@/lib/cash.server'
import type { ForecastRow } from '@/lib/cash'
import type { AgeBucket } from '@/lib/cash'

/**
 * Phase 7 — the executive dashboard is ASSEMBLY, not new analysis. Every figure here is read
 * from an existing 6A–6E derivation (portfolio EVM, cash position, forecast, receivables,
 * unpriced flags). No money is computed that a project page could not already show.
 */

const n = (v: unknown): number => (v == null ? 0 : Number(v))
const CPI_SPI_FLOOR = 0.9 // the existing amber/red threshold

export interface CashHeadline {
  clearedBalance: number
  projectedIn: number
  projectedOut: number
  netPosition: number // clearedBalance + Σ net = the final running balance
  unscheduledPayables: number
}

export interface AgeingSummary {
  buckets: Record<AgeBucket, number>
  overdueTotal: number // 1–30 … 90+, i.e. everything past due
}

export type AttentionKind =
  | 'NEGATIVE_MARGIN' | 'LOW_CPI' | 'LOW_SPI' | 'OVERDUE_RECEIVABLE'
  | 'UNPRICED_SCOPE' | 'UNINVOICED_VALUATION' | 'NO_BASELINE' | 'OVERDUE_PAYABLE'
  | 'RETENTION_DUE'

export interface AttentionItem {
  kind: AttentionKind
  severity: 'warning' | 'danger'
  title: string
  detail: string
  href: string
  impact: number // financial magnitude for ranking; 0 when the condition has no figure
}

export interface ExecutivePortfolioRow extends PortfolioRow {
  outstandingReceivables: number
}

export interface ExecutiveDashboard {
  asOf: string
  months: number
  cash: CashHeadline
  forecast: ForecastRow[]
  goesNegativeMonth: string | null
  portfolio: ExecutivePortfolioRow[]
  totals: { bac: number; pv: number; ev: number; ac: number; spi: number | null; cpi: number | null }
  ageing: AgeingSummary
  attention: AttentionItem[]
  attentionMore: number // conditions beyond the visible cap
}

const ATTENTION_CAP = 10

export async function loadExecutiveDashboard(months: number, today: Date): Promise<ExecutiveDashboard> {
  const [portfolio, forecast, receivables, uninvoiced, overduePayables, retention] = await Promise.all([
    loadPortfolioEvm(today),
    loadForecast(months, today),
    loadReceivables({ today }),
    // Certified, live, not-yet-invoiced valuations — money not yet asked for.
    prisma.valuation.findMany({
      where: { status: 'CERTIFIED', supersededAt: null, invoicedAt: null },
      select: { id: true, valuationCode: true, projectId: true, netPayable: true, project: { select: { name: true } } },
    }),
    // Overdue payables: a due date in the past with amount still outstanding.
    loadOverduePayables(today),
    // Retention past a tranche due date and still outstanding (the easiest money to forget).
    loadAllRetention(today),
  ])

  // ── cash headline ──
  const projectedIn = round(forecast.months.reduce((s, m) => s + m.projectedInflow, 0), MONEY_DP)
  const projectedOut = round(forecast.months.reduce((s, m) => s + m.projectedOutflow, 0), MONEY_DP)
  const netPosition = forecast.months.length > 0 ? forecast.months[forecast.months.length - 1]!.runningBalance : forecast.clearedBalance
  const cash: CashHeadline = {
    clearedBalance: forecast.clearedBalance,
    projectedIn,
    projectedOut,
    netPosition,
    unscheduledPayables: forecast.unscheduledPayables,
  }
  const goesNegativeMonth = forecast.months.find((m) => m.runningBalance < 0)?.month ?? null

  // ── receivables per project (for the portfolio table) + ageing summary ──
  const outstandingByProject = new Map<string, number>()
  const buckets: Record<AgeBucket, number> = {
    NO_DUE_DATE: 0, NOT_YET_DUE: 0, DUE_1_30: 0, DUE_31_60: 0, DUE_61_90: 0, DUE_90_PLUS: 0,
  }
  const overdue60ByProject = new Map<string, { name: string; amount: number }>()
  for (const r of receivables) {
    outstandingByProject.set(r.projectId, round((outstandingByProject.get(r.projectId) ?? 0) + r.outstanding, MONEY_DP))
    if (r.outstanding > 0) buckets[r.ageBucket] = round(buckets[r.ageBucket] + r.outstanding, MONEY_DP)
    if ((r.ageBucket === 'DUE_61_90' || r.ageBucket === 'DUE_90_PLUS') && r.outstanding > 0) {
      const cur = overdue60ByProject.get(r.projectId) ?? { name: r.projectName, amount: 0 }
      cur.amount = round(cur.amount + r.outstanding, MONEY_DP)
      overdue60ByProject.set(r.projectId, cur)
    }
  }
  const overdueTotal = round(
    buckets.DUE_1_30 + buckets.DUE_31_60 + buckets.DUE_61_90 + buckets.DUE_90_PLUS, MONEY_DP,
  )
  const ageing: AgeingSummary = { buckets, overdueTotal }

  const portfolioRows: ExecutivePortfolioRow[] = portfolio.projects.map((p) => ({
    ...p, outstandingReceivables: outstandingByProject.get(p.projectId) ?? 0,
  }))

  // ── attention list (ranked, capped) ──
  const items: AttentionItem[] = []
  const projectHref = (id: string) => `/admin/projects/${id}`
  for (const p of portfolio.projects) {
    if (p.projectedMargin < 0) {
      items.push({ kind: 'NEGATIVE_MARGIN', severity: 'danger', title: `${p.projectName}: negative forecast margin`, detail: `Forecast margin ${p.projectedMargin.toFixed(3)} — costs are outrunning revenue.`, href: projectHref(p.projectId), impact: Math.abs(p.projectedMargin) })
    }
    if (p.cpi != null && p.cpi < CPI_SPI_FLOOR) {
      items.push({ kind: 'LOW_CPI', severity: p.cpi < 0.8 ? 'danger' : 'warning', title: `${p.projectName}: CPI ${p.cpi.toFixed(2)}`, detail: `Spending faster than earning value (AC ${p.ac.toFixed(3)} vs EV ${p.ev.toFixed(3)}).`, href: `${projectHref(p.projectId)}/performance`, impact: Math.abs(p.ac - p.ev) })
    }
    if (p.spi != null && p.spi < CPI_SPI_FLOOR) {
      items.push({ kind: 'LOW_SPI', severity: p.spi < 0.8 ? 'danger' : 'warning', title: `${p.projectName}: SPI ${p.spi.toFixed(2)}`, detail: `Behind schedule against the baseline.`, href: `${projectHref(p.projectId)}/performance`, impact: p.pv != null ? Math.abs(p.pv - p.ev) : 0 })
    }
    if (p.unpricedCount > 0) {
      items.push({ kind: 'UNPRICED_SCOPE', severity: 'warning', title: `${p.projectName}: ${p.unpricedCount} unpriced item(s)`, detail: `Unpriced scope understates cost, margin and EVM for this project.`, href: projectHref(p.projectId), impact: 0 })
    }
    if (!p.hasBaseline) {
      items.push({ kind: 'NO_BASELINE', severity: 'warning', title: `${p.projectName}: no baseline`, detail: `Without a baseline S-curve, SPI and schedule variance are unavailable.`, href: `${projectHref(p.projectId)}/performance`, impact: 0 })
    }
  }
  for (const o of overdue60ByProject.values()) {
    items.push({ kind: 'OVERDUE_RECEIVABLE', severity: 'danger', title: `${o.name}: ${o.amount.toFixed(3)} overdue 60+ days`, detail: `Receivables more than 60 days past their expected receipt.`, href: '/admin/cash', impact: o.amount })
  }
  for (const v of uninvoiced) {
    items.push({ kind: 'UNINVOICED_VALUATION', severity: 'warning', title: `${v.project.name}: ${v.valuationCode} not invoiced`, detail: `Certified but no invoice sent — ${n(v.netPayable).toFixed(3)} not yet asked for.`, href: `/admin/projects/${v.projectId}/valuations/${v.id}`, impact: n(v.netPayable) })
  }
  for (const e of overduePayables) {
    items.push({ kind: 'OVERDUE_PAYABLE', severity: 'warning', title: `Overdue payable: ${e.description}`, detail: `${e.outstanding.toFixed(3)} due ${e.dueDate} and still outstanding${e.projectName ? ` · ${e.projectName}` : ''}.`, href: e.projectId ? `${projectHref(e.projectId)}` : '/admin/cash', impact: e.outstanding })
  }
  for (const r of retention.pastDue) {
    items.push({ kind: 'RETENTION_DUE', severity: 'warning', title: `${r.projectName}: ${r.outstanding.toFixed(3)} retention due`, detail: `A retention release tranche is past its due date and still outstanding.`, href: `${projectHref(r.projectId)}/valuations`, impact: r.outstanding })
  }

  items.sort((a, b) => b.impact - a.impact)
  const attention = items.slice(0, ATTENTION_CAP)
  const attentionMore = Math.max(0, items.length - ATTENTION_CAP)

  return {
    asOf: today.toISOString().slice(0, 10),
    months,
    cash,
    forecast: forecast.months,
    goesNegativeMonth,
    portfolio: portfolioRows,
    totals: portfolio.totals,
    ageing,
    attention,
    attentionMore,
  }
}

interface OverduePayable { description: string; outstanding: number; dueDate: string; projectId: string | null; projectName: string | null }

async function loadOverduePayables(today: Date): Promise<OverduePayable[]> {
  const expenses = await prisma.expense.findMany({
    where: { dueDate: { lt: today, not: null } },
    select: { description: true, amount: true, dueDate: true, projectId: true, project: { select: { name: true } }, payments: { where: { direction: 'OUT' }, select: { amount: true } } },
  })
  return expenses
    .map((e) => {
      const paid = e.payments.reduce((s, p) => s + n(p.amount), 0)
      return {
        description: e.description,
        outstanding: round(n(e.amount) - paid, MONEY_DP),
        dueDate: e.dueDate!.toISOString().slice(0, 10),
        projectId: e.projectId,
        projectName: e.project?.name ?? null,
      }
    })
    .filter((e) => e.outstanding > 0)
}
