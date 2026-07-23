'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { CashHeadline, AgeingSummary, AttentionItem, ExecutivePortfolioRow } from '@/lib/executive.server'
import { AGE_BUCKET_LABEL, type AgeBucket } from '@/lib/cash'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'

function bhd(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })
}
function bhd0(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}
const na = (v: number | null) => (v == null ? 'N/A' : v.toFixed(2))

// ─── Cash headline ─────────────────────────────────────────────────────────────

export function CashHeadlinePanel({ cash, months }: { cash: CashHeadline; months: number }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Cash position</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Cleared balance" value={bhd(cash.clearedBalance)} />
        <Stat label={`Projected in (${months}m)`} value={bhd(cash.projectedIn)} tone="pos" />
        <Stat label={`Projected out (${months}m)`} value={bhd(cash.projectedOut)} tone="neg" />
        <Stat label="Net position" value={bhd(cash.netPosition)} tone={cash.netPosition < 0 ? 'danger' : undefined} strong />
      </div>
      {cash.unscheduledPayables > 0 && (
        <p className="text-xs text-warning">
          Plus {bhd(cash.unscheduledPayables)} of unscheduled payables (expenses with no due date) — outstanding but not in any month above.
        </p>
      )}
    </section>
  )
}

function Stat({ label, value, tone, strong }: { label: string; value: string; tone?: 'pos' | 'neg' | 'danger'; strong?: boolean }) {
  const color = tone === 'danger' ? 'text-danger' : tone === 'pos' ? 'text-success' : tone === 'neg' ? 'text-danger' : 'text-fg'
  return (
    <div className={`rounded-lg border bg-surface p-4 ${strong ? 'border-primary' : 'border-border'}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  )
}

// ─── Ageing summary ──────────────────────────────────────────────────────────────

const BUCKET_ORDER: AgeBucket[] = ['NOT_YET_DUE', 'DUE_1_30', 'DUE_31_60', 'DUE_61_90', 'DUE_90_PLUS', 'NO_DUE_DATE']

export function AgeingSummaryPanel({ ageing }: { ageing: AgeingSummary }) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Receivables ageing</h2>
        <Link href="/admin/cash" className="text-xs font-medium text-primary hover:underline">Open Cash →</Link>
      </div>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {BUCKET_ORDER.map((b) => (
          <div key={b} className={`rounded-lg border bg-surface p-3 ${b === 'DUE_61_90' || b === 'DUE_90_PLUS' ? 'border-danger' : 'border-border'}`}>
            <p className="text-xs text-fg-subtle">{AGE_BUCKET_LABEL[b]}</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-fg">{bhd0(ageing.buckets[b])}</p>
          </div>
        ))}
      </div>
      {ageing.overdueTotal > 0 && (
        <p className="text-xs text-danger">Overdue total (past due): <span className="font-semibold tabular-nums">{bhd(ageing.overdueTotal)}</span>.</p>
      )}
    </section>
  )
}

// ─── Attention list ──────────────────────────────────────────────────────────────

export function AttentionListPanel({ items, more }: { items: AttentionItem[]; more: number }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Needs attention</h2>
      {items.length === 0 ? (
        <EmptyState title="Nothing flagged" description="No negative margins, low indices, overdue money or unpriced scope right now." />
      ) : (
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li key={i}>
              <Link href={it.href} className="flex items-start gap-3 rounded-lg border border-border bg-surface px-4 py-2.5 hover:bg-surface-muted">
                <Badge tone={it.severity === 'danger' ? 'danger' : 'warning'}>{it.severity === 'danger' ? '!' : '•'}</Badge>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-fg">{it.title}</span>
                  <span className="block text-xs text-fg-subtle">{it.detail}</span>
                </span>
              </Link>
            </li>
          ))}
          {more > 0 && <li className="px-1 text-xs text-fg-subtle">+{more} more condition(s) not shown.</li>}
        </ul>
      )}
    </section>
  )
}

// ─── Portfolio table (client-sortable) ─────────────────────────────────────────

type SortKey = 'projectName' | 'contractValue' | 'bac' | 'ev' | 'ac' | 'cpi' | 'spi' | 'projectedMargin' | 'outstandingReceivables'

export function PortfolioTable({
  rows,
  totals,
}: {
  rows: ExecutivePortfolioRow[]
  totals: { bac: number; ev: number; ac: number; spi: number | null; cpi: number | null }
}) {
  const [sort, setSort] = useState<SortKey>('projectedMargin')
  const [asc, setAsc] = useState(true)

  const sorted = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => {
      const av = a[sort], bv = b[sort]
      if (typeof av === 'string' && typeof bv === 'string') return asc ? av.localeCompare(bv) : bv.localeCompare(av)
      const an = (av ?? Number.NEGATIVE_INFINITY) as number, bn = (bv ?? Number.NEGATIVE_INFINITY) as number
      return asc ? an - bn : bn - an
    })
    return copy
  }, [rows, sort, asc])

  function header(key: SortKey, label: string, right = false) {
    const active = sort === key
    return (
      <TH className={right ? 'text-right' : ''}>
        <button
          type="button"
          className={`inline-flex items-center gap-1 ${active ? 'text-fg' : 'text-fg-subtle'} hover:text-fg`}
          onClick={() => { if (active) setAsc((v) => !v); else { setSort(key); setAsc(false) } }}
        >
          {label}{active && <span className="text-xs">{asc ? '▲' : '▼'}</span>}
        </button>
      </TH>
    )
  }

  if (rows.length === 0) {
    return <EmptyState title="No active projects" description="Active projects with scope appear here." />
  }

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Portfolio</h2>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <Table>
          <THead>
            <TR>
              {header('projectName', 'Project')}
              {header('contractValue', 'Contract', true)}
              {header('bac', 'BAC', true)}
              {header('ev', 'EV', true)}
              {header('ac', 'AC', true)}
              {header('cpi', 'CPI', true)}
              {header('spi', 'SPI', true)}
              {header('projectedMargin', 'Fcst margin', true)}
              {header('outstandingReceivables', 'Receivable', true)}
            </TR>
          </THead>
          <TBody>
            {sorted.map((p) => (
              <TR key={p.projectId}>
                <TD>
                  <Link href={`/admin/projects/${p.projectId}`} className="font-medium text-primary hover:underline">{p.projectName}</Link>
                  {p.unpricedCount > 0 && <Badge tone="warning" className="ml-2">unpriced</Badge>}
                </TD>
                <TD className="text-right tabular-nums">{bhd0(p.contractValue)}</TD>
                <TD className="text-right tabular-nums">{bhd0(p.bac)}</TD>
                <TD className="text-right tabular-nums">{bhd0(p.ev)}</TD>
                <TD className="text-right tabular-nums">{bhd0(p.ac)}</TD>
                <TD className={`text-right tabular-nums ${p.cpi != null && p.cpi < 0.9 ? 'text-danger' : ''}`}>{na(p.cpi)}</TD>
                <TD className={`text-right tabular-nums ${p.spi != null && p.spi < 0.9 ? 'text-danger' : ''}`}>{p.hasBaseline ? na(p.spi) : '—'}</TD>
                <TD className={`text-right tabular-nums ${p.projectedMargin < 0 ? 'text-danger' : ''}`}>{bhd0(p.projectedMargin)}</TD>
                <TD className="text-right tabular-nums">{bhd0(p.outstandingReceivables)}</TD>
              </TR>
            ))}
          </TBody>
          <tfoot>
            <TR className="border-t-2 border-border-strong font-medium">
              <TD>Company (value-weighted)</TD>
              <TD className="text-right tabular-nums" />
              <TD className="text-right tabular-nums">{bhd0(totals.bac)}</TD>
              <TD className="text-right tabular-nums">{bhd0(totals.ev)}</TD>
              <TD className="text-right tabular-nums">{bhd0(totals.ac)}</TD>
              <TD className="text-right tabular-nums">{na(totals.cpi)}</TD>
              <TD className="text-right tabular-nums">{na(totals.spi)}</TD>
              <TD className="text-right tabular-nums" />
              <TD className="text-right tabular-nums" />
            </TR>
          </tfoot>
        </Table>
      </div>
      <p className="text-xs text-fg-subtle">Company CPI/SPI are value-weighted (ΣEV/ΣAC, ΣEV/ΣPV), never an average of project indices.</p>
    </section>
  )
}
