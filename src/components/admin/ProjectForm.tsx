'use client'

import { useState } from 'react'
import type { ProjectStatus } from '@prisma/client'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'

export interface UserOption {
  id: string
  userCode: string
  firstName: string
  lastName: string
  role: string
}

/** Header financials as free-text form values ('' = not set / cleared). */
export interface ProjectFormFinancials {
  contractValue: string
  budgetCost: string
  retentionPct: string
  retentionCapPct: string
  advancePct: string
  paymentTermsDays: string
  currency: string
}

export interface ProjectFormInitial {
  name: string
  location: string
  status: ProjectStatus
  startDate: string // YYYY-MM-DD or ''
  memberIds: string[]
  financials?: Partial<ProjectFormFinancials>
}

export interface ProjectFormPayload {
  name: string
  location: string
  status: ProjectStatus
  startDate: string | null
  memberIds: string[]
  // Financials: null = cleared/none; a value = set. Sent on both create and edit.
  contractValue: number | null
  budgetCost: number | null
  retentionPct: number | null
  retentionCapPct: number | null
  advancePct: number | null
  paymentTermsDays: number | null
  currency: string
}

/** '' → null; otherwise the numeric value (server re-validates the bounds). */
function numOrNull(v: string): number | null {
  const t = v.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** Expand the Financials section by default when the project already carries any of them. */
function hasFinancials(f?: Partial<ProjectFormFinancials>): boolean {
  if (!f) return false
  return Object.values(f).some((v) => v != null && String(v).trim() !== '')
}

export function ProjectForm({
  mode,
  initial,
  users,
  submitting,
  onSubmit,
  onCancel,
}: {
  mode: 'create' | 'edit'
  initial?: ProjectFormInitial
  users: UserOption[]
  submitting: boolean
  onSubmit: (payload: ProjectFormPayload) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [location, setLocation] = useState(initial?.location ?? '')
  const [status, setStatus] = useState<ProjectStatus>(initial?.status ?? 'ACTIVE')
  const [startDate, setStartDate] = useState(initial?.startDate ?? '')
  const [memberIds, setMemberIds] = useState<string[]>(initial?.memberIds ?? [])

  const fin = initial?.financials
  const [contractValue, setContractValue] = useState(fin?.contractValue ?? '')
  const [budgetCost, setBudgetCost] = useState(fin?.budgetCost ?? '')
  const [retentionPct, setRetentionPct] = useState(fin?.retentionPct ?? '')
  const [retentionCapPct, setRetentionCapPct] = useState(fin?.retentionCapPct ?? '')
  const [advancePct, setAdvancePct] = useState(fin?.advancePct ?? '')
  // New projects prefill the 45-day default so it's visible; editing shows the stored value.
  const [paymentTermsDays, setPaymentTermsDays] = useState(fin?.paymentTermsDays ?? (mode === 'create' ? '45' : ''))
  const [currency, setCurrency] = useState(fin?.currency ?? (mode === 'create' ? 'BHD' : ''))

  function toggleMember(id: string) {
    setMemberIds((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    onSubmit({
      name: name.trim(),
      location: location.trim(),
      status,
      startDate: startDate.trim() === '' ? null : startDate,
      memberIds,
      contractValue: numOrNull(contractValue),
      budgetCost: numOrNull(budgetCost),
      retentionPct: numOrNull(retentionPct),
      retentionCapPct: numOrNull(retentionCapPct),
      advancePct: numOrNull(advancePct),
      paymentTermsDays: numOrNull(paymentTermsDays),
      currency: currency.trim() === '' ? 'BHD' : currency.trim().toUpperCase(),
    })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Input label="Project name" value={name} onChange={(e) => setName(e.target.value)} required />
      <Input label="Location (optional)" value={location} onChange={(e) => setLocation(e.target.value)} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
          <option value="ACTIVE">Active</option>
          <option value="ON_HOLD">On hold</option>
          <option value="COMPLETED">Completed</option>
        </Select>
        <Input
          label="Start date (optional)"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
      </div>

      <details className="rounded-md border border-border" open={hasFinancials(initial?.financials)}>
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-fg">
          Financials (optional)
        </summary>
        <div className="space-y-4 border-t border-border px-3 py-3">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Contract value (BHD)" type="number" min="0" step="0.001" inputMode="decimal"
              value={contractValue} onChange={(e) => setContractValue(e.target.value)}
              placeholder="from build-up if blank"
            />
            <Input
              label="Budget cost (BHD)" type="number" min="0" step="0.001" inputMode="decimal"
              value={budgetCost} onChange={(e) => setBudgetCost(e.target.value)}
              placeholder="from build-up if blank"
            />
          </div>
          <p className="text-xs text-fg-subtle">
            Header values are cross-checked against the bottom-up build-up — a divergence banner appears on the
            budget view if they disagree. The build-up stays authoritative.
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Input
              label="Retention %" type="number" min="0" max="100" step="0.01" inputMode="decimal"
              value={retentionPct} onChange={(e) => setRetentionPct(e.target.value)} placeholder="none"
            />
            <Input
              label="Retention cap %" type="number" min="0" max="100" step="0.01" inputMode="decimal"
              value={retentionCapPct} onChange={(e) => setRetentionCapPct(e.target.value)} placeholder="uncapped"
            />
            <Input
              label="Advance %" type="number" min="0" max="100" step="0.01" inputMode="decimal"
              value={advancePct} onChange={(e) => setAdvancePct(e.target.value)} placeholder="none"
            />
          </div>
          {retentionCapPct.trim() !== '' && retentionPct.trim() === '' && (
            <p className="text-xs text-warning">Retention cap has no effect until a retention % is set.</p>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Payment terms (days)" type="number" min="0" step="1" inputMode="numeric"
              value={paymentTermsDays} onChange={(e) => setPaymentTermsDays(e.target.value)} placeholder="none"
            />
            <Input
              label="Currency" value={currency} maxLength={3}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())} placeholder="BHD"
            />
          </div>
          <p className="text-xs text-fg-subtle">
            Payment terms set each certified valuation&apos;s expected receipt date (certified date + days). Leave
            blank for no agreed terms — certificates then carry no expected-receipt date. Single-currency only;
            multi-currency is not handled.
          </p>
        </div>
      </details>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-fg">Assigned members</span>
        {users.length === 0 ? (
          <p className="text-sm text-fg-subtle">No users yet. Create a user first.</p>
        ) : (
          <div className="max-h-44 overflow-y-auto rounded-md border border-border-strong">
            {users.map((u) => (
              <label
                key={u.id}
                className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0 hover:bg-surface-subtle"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={memberIds.includes(u.id)}
                  onChange={() => toggleMember(u.id)}
                />
                <span className="text-sm text-fg">
                  {u.firstName} {u.lastName}
                </span>
                <span className="mono ml-auto text-xs text-fg-subtle">{u.userCode}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" loading={submitting}>
          {mode === 'create' ? 'Create project' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}
