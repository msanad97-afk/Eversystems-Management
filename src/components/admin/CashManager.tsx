'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CashCategory } from '@prisma/client'
import type { LedgerRow } from '@/lib/cash.server'
import { directionFor } from '@/lib/cash'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { useToast } from '@/contexts/ToastContext'

export interface AccountOption { id: string; name: string; currency: string }
export interface ProjectOption { id: string; name: string }

const CATEGORY_LABEL: Record<CashCategory, string> = {
  VALUATION_RECEIPT: 'Valuation receipt', ADVANCE_PAYMENT: 'Advance payment', RETENTION_RELEASE: 'Retention release',
  SUPPLIER_PAYMENT: 'Supplier payment', SUBCONTRACTOR_PAYMENT: 'Subcontractor payment', PAYROLL: 'Payroll',
  EQUIPMENT: 'Equipment', OVERHEAD: 'Overhead', VAT_TAX: 'VAT / tax', LOAN_FINANCE: 'Loan / finance',
  OTHER_IN: 'Other (in)', OTHER_OUT: 'Other (out)',
}
const ALL_CATEGORIES = Object.keys(CATEGORY_LABEL) as CashCategory[]

function bhd(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })
}

export function CashManager({
  accounts,
  projects,
  ledger,
  total,
}: {
  accounts: AccountOption[]
  projects: ProjectOption[]
  ledger: LedgerRow[]
  total: number
}) {
  const router = useRouter()
  const { showToast } = useToast()
  const [accountOpen, setAccountOpen] = useState(false)
  const [txnOpen, setTxnOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function clearToggle(row: LedgerRow) {
    setBusy(true)
    try {
      const res = await fetch(`/api/cash/transactions/${row.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clearedAt: row.clearedAt ? '' : new Date().toISOString().slice(0, 10) }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not update.')
      showToast(row.clearedAt ? 'Marked pending.' : 'Marked cleared.', 'success')
      router.refresh()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update.', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function remove(row: LedgerRow) {
    if (!confirm(`Delete this ${row.direction === 'IN' ? 'inflow' : 'outflow'} of ${bhd(row.amount)}?\n\nThe deletion is recorded in the audit log.`)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/cash/transactions/${row.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not delete.')
      showToast('Transaction deleted.', 'success')
      router.refresh()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not delete.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Ledger</h2>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setAccountOpen(true)}>New account</Button>
          <Button size="sm" onClick={() => setTxnOpen(true)} disabled={accounts.length === 0}>Record transaction</Button>
        </div>
      </div>

      {ledger.length === 0 ? (
        <EmptyState title="No transactions yet" description="Record a cash movement to build the ledger." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <Table>
            <THead>
              <TR>
                <TH>Date</TH><TH>Account</TH><TH>Category</TH><TH>Description</TH>
                <TH>Match</TH><TH className="text-right">In</TH><TH className="text-right">Out</TH><TH>Status</TH><TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {ledger.map((t) => (
                <TR key={t.id} className={t.clearedAt ? '' : 'bg-surface-muted'}>
                  <TD className="whitespace-nowrap">{t.txnDate}</TD>
                  <TD>{t.accountName}</TD>
                  <TD>{CATEGORY_LABEL[t.category]}</TD>
                  <TD className="max-w-[16rem] truncate">{t.description}</TD>
                  <TD className="text-xs text-fg-muted">
                    {t.valuationCode ?? (t.projectName ? t.projectName : t.expenseId ? 'expense' : '—')}
                  </TD>
                  <TD className="text-right tabular-nums text-success">{t.direction === 'IN' ? bhd(t.amount) : ''}</TD>
                  <TD className="text-right tabular-nums text-danger">{t.direction === 'OUT' ? bhd(t.amount) : ''}</TD>
                  <TD>{t.clearedAt ? <Badge tone="success">cleared</Badge> : <Badge tone="warning">pending</Badge>}</TD>
                  <TD>
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => clearToggle(t)}>{t.clearedAt ? 'Unclear' : 'Clear'}</Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => remove(t)}>Delete</Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {total > ledger.length && <p className="px-4 py-2 text-xs text-fg-subtle">Showing {ledger.length} of {total}. Refine with filters (coming from the API) to see more.</p>}
        </div>
      )}

      <Modal open={accountOpen} onClose={() => setAccountOpen(false)} title="New bank account">
        <NewAccountForm onDone={() => { setAccountOpen(false); router.refresh() }} />
      </Modal>
      <Modal open={txnOpen} onClose={() => setTxnOpen(false)} title="Record transaction">
        <RecordTxnForm accounts={accounts} projects={projects} onDone={() => { setTxnOpen(false); router.refresh() }} />
      </Modal>
    </section>
  )
}

function NewAccountForm({ onDone }: { onDone: () => void }) {
  const { showToast } = useToast()
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('BHD')
  const [openingBalance, setOpeningBalance] = useState('0')
  const [openingDate, setOpeningDate] = useState(new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await fetch('/api/cash/accounts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, currency, openingBalance: Number(openingBalance), openingDate }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not create.')
      showToast('Account created.', 'success')
      onDone()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not create.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Input label="Account name" value={name} onChange={(e) => setName(e.target.value)} required />
      <div className="grid grid-cols-2 gap-4">
        <Input label="Currency" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
        <Input label="Opening balance" type="number" step="0.001" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} />
      </div>
      <Input label="Opening date" type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} required />
      <div className="flex justify-end"><Button type="submit" loading={busy}>Create account</Button></div>
    </form>
  )
}

function RecordTxnForm({ accounts, projects, onDone }: { accounts: AccountOption[]; projects: ProjectOption[]; onDone: () => void }) {
  const { showToast } = useToast()
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const [category, setCategory] = useState<CashCategory>('SUPPLIER_PAYMENT')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [txnDate, setTxnDate] = useState(new Date().toISOString().slice(0, 10))
  const [projectId, setProjectId] = useState('')
  const [cleared, setCleared] = useState(true)
  const [busy, setBusy] = useState(false)

  const direction = directionFor(category)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      const res = await fetch('/api/cash/transactions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          accountId, category, amount: Number(amount), description, txnDate,
          projectId: projectId || null,
          clearedAt: cleared ? txnDate : null,
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not record.')
      showToast('Transaction recorded.', 'success')
      onDone()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not record.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Select label="Account" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
      </Select>
      <div className="grid grid-cols-2 gap-4">
        <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value as CashCategory)}>
          {ALL_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </Select>
        <div className="flex items-end pb-2">
          <Badge tone={direction === 'IN' ? 'success' : 'danger'}>{direction === 'IN' ? 'money in' : 'money out'}</Badge>
        </div>
      </div>
      {category === 'LOAN_FINANCE' && (
        <p className="text-xs text-fg-subtle">Loan / finance records a repayment (out). For a drawdown, use Other (in).</p>
      )}
      <div className="grid grid-cols-2 gap-4">
        <Input label="Amount" type="number" step="0.001" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        <Input label="Date" type="date" value={txnDate} onChange={(e) => setTxnDate(e.target.value)} required />
      </div>
      <Input label="Description" value={description} onChange={(e) => setDescription(e.target.value)} required />
      <Select label="Project (optional)" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
        <option value="">— company / unallocated —</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </Select>
      <label className="flex items-center gap-2 text-sm text-fg">
        <input type="checkbox" className="h-4 w-4 accent-primary" checked={cleared} onChange={(e) => setCleared(e.target.checked)} />
        Already cleared the bank (uncheck for a pending entry)
      </label>
      <p className="text-xs text-fg-subtle">To record a valuation receipt matched to a certificate, use “Record receipt” on that valuation.</p>
      <div className="flex justify-end"><Button type="submit" loading={busy}>Record</Button></div>
    </form>
  )
}
