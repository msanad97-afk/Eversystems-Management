'use client'

import { Button } from '@/components/ui/Button'
import { computeManpowerTotals } from '@/lib/reports/rules'
import { type ManRow, type CategoryOption, newKey } from '@/components/reports/formTypes'

export function ManpowerSection({
  rows,
  onChange,
  categories,
  disabled,
}: {
  rows: ManRow[]
  onChange: (rows: ManRow[]) => void
  categories: CategoryOption[]
  disabled?: boolean
}) {
  const update = (key: string, patch: Partial<ManRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const remove = (key: string) => onChange(rows.filter((r) => r.key !== key))
  const add = () => onChange([...rows, { key: newKey(), categoryId: '', headcount: '', hours: '8' }])

  const usedIds = new Set(rows.map((r) => r.categoryId).filter(Boolean))
  const totals = computeManpowerTotals(
    rows.map((r) => ({ categoryId: r.categoryId, headcount: Number(r.headcount), hours: Number(r.hours) })),
  )

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.key} className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
          <div className="min-w-[45%] flex-1">
            <label className="mb-1 block text-xs font-medium text-fg-subtle">Trade</label>
            <select
              value={row.categoryId}
              onChange={(e) => update(row.key, { categoryId: e.target.value })}
              disabled={disabled}
              className="h-10 w-full rounded-md border border-border-strong bg-surface px-2 text-sm text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:bg-surface-muted"
            >
              <option value="">Select…</option>
              {categories.map((c) => (
                <option
                  key={c.id}
                  value={c.id}
                  disabled={usedIds.has(c.id) && c.id !== row.categoryId}
                >
                  {c.name}
                  {!c.isActive ? ' (inactive)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="w-20">
            <label className="mb-1 block text-xs font-medium text-fg-subtle">Workers</label>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={row.headcount}
              onChange={(e) => update(row.key, { headcount: e.target.value })}
              disabled={disabled}
              className="h-10 w-full rounded-md border border-border-strong bg-surface px-2 text-sm text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:bg-surface-muted"
            />
          </div>
          <div className="w-20">
            <label className="mb-1 block text-xs font-medium text-fg-subtle">Hours</label>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.5"
              value={row.hours}
              onChange={(e) => update(row.key, { hours: e.target.value })}
              disabled={disabled}
              className="h-10 w-full rounded-md border border-border-strong bg-surface px-2 text-sm text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:bg-surface-muted"
            />
          </div>
          {!disabled && (
            <Button type="button" variant="ghost" size="sm" onClick={() => remove(row.key)}>
              Remove
            </Button>
          )}
        </div>
      ))}

      {rows.length > 0 && (
        <div className="rounded-md bg-surface-subtle px-3 py-2 text-sm font-medium text-fg">
          Total: {totals.workers} workers · {totals.manHours} man-hours
        </div>
      )}

      {!disabled && (
        <Button type="button" variant="secondary" size="sm" onClick={add} fullWidth>
          + Add trade
        </Button>
      )}
    </div>
  )
}
