'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { CashCategory } from '@prisma/client'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'

export interface FilterOption { id: string; name: string }

const CATEGORY_LABEL: Record<CashCategory, string> = {
  VALUATION_RECEIPT: 'Valuation receipt', ADVANCE_PAYMENT: 'Advance payment', RETENTION_RELEASE: 'Retention release',
  SUPPLIER_PAYMENT: 'Supplier payment', SUBCONTRACTOR_PAYMENT: 'Subcontractor payment', PAYROLL: 'Payroll',
  EQUIPMENT: 'Equipment', OVERHEAD: 'Overhead', VAT_TAX: 'VAT / tax', LOAN_FINANCE: 'Loan / finance',
  OTHER_IN: 'Other (in)', OTHER_OUT: 'Other (out)',
}
const ALL_CATEGORIES = Object.keys(CATEGORY_LABEL) as CashCategory[]

/**
 * Filter + pagination controls for the cash ledger. Drives the page via URL search params —
 * the server component reads them and re-queries `loadLedger`. No API change: every control
 * maps to a filter the ledger endpoint already supports.
 */
export function CashLedgerFilters({
  accounts,
  projects,
  total,
  page,
  pageSize,
  shown,
}: {
  accounts: FilterOption[]
  projects: FilterOption[]
  total: number
  page: number
  pageSize: number
  shown: number
}) {
  const router = useRouter()
  const params = useSearchParams()
  const get = (k: string) => params.get(k) ?? ''

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString())
    if (value === '') next.delete(key)
    else next.set(key, value)
    if (key !== 'page') next.delete('page') // any filter change resets to the first page
    router.push(`/admin/cash?${next.toString()}`)
  }
  function clearAll() { router.push('/admin/cash') }

  const from = (page - 1) * pageSize
  const hasPrev = page > 1
  const hasNext = from + shown < total

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-44">
          <Select label="Account" value={get('accountId')} onChange={(e) => setParam('accountId', e.target.value)}>
            <option value="">All accounts</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </div>
        <div className="w-44">
          <Select label="Project" value={get('projectId')} onChange={(e) => setParam('projectId', e.target.value)}>
            <option value="">All projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </div>
        <div className="w-44">
          <Select label="Category" value={get('category')} onChange={(e) => setParam('category', e.target.value)}>
            <option value="">All categories</option>
            {ALL_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </Select>
        </div>
        <div className="w-32">
          <Select label="Direction" value={get('direction')} onChange={(e) => setParam('direction', e.target.value)}>
            <option value="">In &amp; out</option>
            <option value="IN">In</option>
            <option value="OUT">Out</option>
          </Select>
        </div>
        <div className="w-32">
          <Select label="Status" value={get('cleared')} onChange={(e) => setParam('cleared', e.target.value)}>
            <option value="">Any</option>
            <option value="true">Cleared</option>
            <option value="false">Pending</option>
          </Select>
        </div>
        <div className="w-36">
          <Select label="Matched" value={get('matched')} onChange={(e) => setParam('matched', e.target.value)}>
            <option value="">Any</option>
            <option value="true">Matched</option>
            <option value="false">Unmatched</option>
          </Select>
        </div>
        <div className="w-36"><Input label="From" type="date" value={get('from')} onChange={(e) => setParam('from', e.target.value)} /></div>
        <div className="w-36"><Input label="To" type="date" value={get('to')} onChange={(e) => setParam('to', e.target.value)} /></div>
        <Button size="sm" variant="ghost" onClick={clearAll}>Clear</Button>
      </div>

      <div className="flex items-center justify-between text-xs text-fg-subtle">
        <span>{total === 0 ? 'No matching transactions' : `Showing ${from + 1}–${from + shown} of ${total}`}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" disabled={!hasPrev} onClick={() => setParam('page', String(page - 1))}>Previous</Button>
          <Button size="sm" variant="secondary" disabled={!hasNext} onClick={() => setParam('page', String(page + 1))}>Next</Button>
        </div>
      </div>
    </div>
  )
}
