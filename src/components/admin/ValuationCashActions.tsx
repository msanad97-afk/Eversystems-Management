'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { useToast } from '@/contexts/ToastContext'

export interface ReceiptAccount { id: string; name: string; currency: string }

/**
 * Payment-side actions on a CERTIFIED valuation: mark invoiced (the one manual step, which
 * does NOT touch status), and record a receipt matched to this revision (prefilled to the
 * period's outstanding, category VALUATION_RECEIPT). Over-payment prompts for confirmation.
 */
export function ValuationCashActions({
  projectId,
  valuationId,
  invoiced,
  outstanding,
  accounts,
}: {
  projectId: string
  valuationId: string
  invoiced: boolean
  outstanding: number
  accounts: ReceiptAccount[]
}) {
  const router = useRouter()
  const { showToast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [receiptOpen, setReceiptOpen] = useState(false)

  async function invoice(next: boolean) {
    setBusy('invoice')
    try {
      const res = await fetch(`/api/projects/${projectId}/valuations/${valuationId}/invoice`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ invoiced: next }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not update.')
      showToast(next ? 'Marked invoiced.' : 'Invoice mark cleared.', 'success')
      router.refresh()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update.', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" loading={busy === 'invoice'} onClick={() => invoice(!invoiced)}>
        {invoiced ? 'Clear invoiced' : 'Mark invoiced'}
      </Button>
      <Button size="sm" onClick={() => setReceiptOpen(true)} disabled={accounts.length === 0}>Record receipt</Button>
      <Modal open={receiptOpen} onClose={() => setReceiptOpen(false)} title="Record receipt">
        <ReceiptForm
          valuationId={valuationId}
          outstanding={outstanding}
          accounts={accounts}
          onDone={() => { setReceiptOpen(false); router.refresh() }}
        />
      </Modal>
    </div>
  )
}

function ReceiptForm({
  valuationId, outstanding, accounts, onDone,
}: {
  valuationId: string; outstanding: number; accounts: ReceiptAccount[]; onDone: () => void
}) {
  const { showToast } = useToast()
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '')
  const [amount, setAmount] = useState(outstanding > 0 ? String(outstanding) : '')
  const [txnDate, setTxnDate] = useState(new Date().toISOString().slice(0, 10))
  const [cleared, setCleared] = useState(true)
  const [busy, setBusy] = useState(false)

  async function post(allowOverpay: boolean) {
    const res = await fetch('/api/cash/transactions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        accountId, category: 'VALUATION_RECEIPT', amount: Number(amount),
        description: `Receipt against valuation`, txnDate, valuationId,
        clearedAt: cleared ? txnDate : null, allowOverpay,
      }),
    })
    return res
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      let res = await post(false)
      if (res.status === 409) {
        const data = await res.json().catch(() => ({}))
        if (data.requiresOverpayConfirm) {
          if (!confirm(`${data.error}\n\nRecord it anyway as an over-payment?`)) { setBusy(false); return }
          res = await post(true)
        }
      }
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not record.')
      showToast('Receipt recorded.', 'success')
      onDone()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not record.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-fg-subtle">Outstanding on this period: <span className="font-medium text-fg tabular-nums">{outstanding.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}</span></p>
      <Select label="Into account" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
      </Select>
      <div className="grid grid-cols-2 gap-4">
        <Input label="Amount received" type="number" step="0.001" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        <Input label="Date" type="date" value={txnDate} onChange={(e) => setTxnDate(e.target.value)} required />
      </div>
      <label className="flex items-center gap-2 text-sm text-fg">
        <input type="checkbox" className="h-4 w-4 accent-primary" checked={cleared} onChange={(e) => setCleared(e.target.checked)} />
        Already cleared the bank
      </label>
      <div className="flex justify-end"><Button type="submit" loading={busy}>Record receipt</Button></div>
    </form>
  )
}
