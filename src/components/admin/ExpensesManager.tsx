'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { useToast } from '@/contexts/ToastContext'

export interface ExpenseItem {
  id: string
  category: string
  description: string
  vendor: string | null
  expenseDate: string
  amount: number
  eligible: boolean
  exclusionReason: string | null
}

const CATEGORIES = [
  'SUBCONTRACTOR', 'EQUIPMENT_RENTAL', 'SALARIES_INDIRECT', 'SITE_OVERHEAD',
  'MATERIALS_DIRECT', 'HEAD_OFFICE_OVERHEAD', 'OTHER',
] as const

/** Categories that do NOT reach a project's actual cost — surfaced up-front, never silent. */
const EXCLUDED_HINT: Record<string, string> = {
  MATERIALS_DIRECT: 'Excluded from actual cost — materials are costed from daily reports (would double-count).',
  HEAD_OFFICE_OVERHEAD: 'Excluded from a project’s actual cost — company-level overhead.',
}
const label = (c: string) => c.replace(/_/g, ' ').toLowerCase()
const bhd = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })

export function ExpensesManager({ projectId, initial }: { projectId: string; initial: ExpenseItem[] }) {
  const router = useRouter()
  const { showToast } = useToast()
  const [busy, setBusy] = useState(false)
  const [category, setCategory] = useState<string>('SUBCONTRACTOR')
  const [description, setDescription] = useState('')
  const [vendor, setVendor] = useState('')
  const [amount, setAmount] = useState('')
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10))
  const [dueDate, setDueDate] = useState('')

  const valid = description.trim() !== '' && Number(amount) > 0 && expenseDate !== ''

  async function add() {
    if (!valid) return
    setBusy(true)
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, category, description: description.trim(), vendor: vendor.trim() || null, amount: Number(amount), expenseDate, dueDate: dueDate || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not save.')
      setDescription(''); setVendor(''); setAmount(''); setDueDate('')
      router.refresh()
      showToast(data.expense?.eligible ? 'Expense added to actual cost.' : 'Expense saved — excluded from actual cost.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save.', 'error')
    } finally { setBusy(false) }
  }

  async function remove(e: ExpenseItem) {
    if (!confirm(`Delete "${e.description}" (BHD ${bhd(e.amount)})?`)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/expenses/${e.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not delete.')
      router.refresh()
      showToast('Expense deleted.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not delete.', 'error')
    } finally { setBusy(false) }
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Expenses</h2>
        <p className="text-xs text-fg-subtle">
          Costs that don&apos;t flow through daily reports. Labour and site materials come from reports, so those categories are excluded here to avoid double-counting.
        </p>
      </div>

      <div className="space-y-2 rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-44">
            <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (<option key={c} value={c}>{label(c)}</option>))}
            </Select>
          </div>
          <div className="min-w-[30%] flex-1"><Input label="Description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Blockwork subcontract — Nov" /></div>
          <div className="w-36"><Input label="Vendor (optional)" value={vendor} onChange={(e) => setVendor(e.target.value)} /></div>
          <div className="w-32"><Input label="Amount (BHD)" type="number" inputMode="decimal" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div className="w-40"><Input label="Date incurred" type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} /></div>
          <div className="w-40"><Input label="Due date (optional)" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
          <Button onClick={add} loading={busy} disabled={!valid}>Add</Button>
        </div>
        <p className="text-xs text-fg-subtle">Due date drives the cash forecast; blank means <span className="font-medium">unscheduled</span> — outstanding but not placed in any forecast month.</p>
        {EXCLUDED_HINT[category] && (
          <p className="text-xs font-medium text-warning">{EXCLUDED_HINT[category]}</p>
        )}
      </div>

      {initial.length === 0 ? (
        <p className="text-sm text-fg-subtle">No expenses recorded for this project.</p>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border bg-surface">
          {initial.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
              <span className="w-24 shrink-0 text-xs text-fg-muted">{e.expenseDate}</span>
              <span className="min-w-0 flex-1">
                <span className="text-sm text-fg">{e.description}</span>
                <span className="ml-2 text-xs text-fg-subtle">{label(e.category)}{e.vendor ? ` · ${e.vendor}` : ''}</span>
              </span>
              <span className="tabular-nums text-sm text-fg">BHD {bhd(e.amount)}</span>
              {e.eligible
                ? <Badge tone="success">counted</Badge>
                : <Badge tone="neutral" className="max-w-[18rem]" >excluded</Badge>}
              <Button size="sm" variant="ghost" onClick={() => remove(e)}>Delete</Button>
              {!e.eligible && e.exclusionReason && (
                <p className="w-full text-xs text-fg-subtle">{e.exclusionReason}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
