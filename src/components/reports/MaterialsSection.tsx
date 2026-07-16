'use client'

import { Button } from '@/components/ui/Button'
import { type MatRow, type MaterialOption, newKey } from '@/components/reports/formTypes'

export function MaterialsSection({
  rows,
  onChange,
  materials,
  disabled,
}: {
  rows: MatRow[]
  onChange: (rows: MatRow[]) => void
  materials: MaterialOption[]
  disabled?: boolean
}) {
  const update = (key: string, patch: Partial<MatRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const remove = (key: string) => onChange(rows.filter((r) => r.key !== key))
  const add = () => onChange([...rows, { key: newKey(), materialId: '', quantity: '' }])

  const usedIds = new Set(rows.map((r) => r.materialId).filter(Boolean))
  const unitOf = (id: string) => materials.find((m) => m.id === id)?.unit ?? ''

  return (
    <div className="space-y-3">
      {rows.length === 0 && (
        <p className="text-sm text-fg-subtle">
          Optional — a day with no material consumption is valid.
        </p>
      )}
      {rows.map((row) => (
        <div key={row.key} className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
          <div className="min-w-[45%] flex-1">
            <label className="mb-1 block text-xs font-medium text-fg-subtle">Material</label>
            <select
              value={row.materialId}
              onChange={(e) => update(row.key, { materialId: e.target.value })}
              disabled={disabled}
              className="h-10 w-full rounded-md border border-border-strong bg-surface px-2 text-sm text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:bg-surface-muted"
            >
              <option value="">Select…</option>
              {materials.map((m) => (
                <option key={m.id} value={m.id} disabled={usedIds.has(m.id) && m.id !== row.materialId}>
                  {m.name} ({m.unit}){!m.isActive ? ' — inactive' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="w-28">
            <label className="mb-1 block text-xs font-medium text-fg-subtle">
              Quantity{row.materialId ? ` (${unitOf(row.materialId)})` : ''}
            </label>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={row.quantity}
              onChange={(e) => update(row.key, { quantity: e.target.value })}
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
      {!disabled && (
        <Button type="button" variant="secondary" size="sm" onClick={add} fullWidth>
          + Add material
        </Button>
      )}
    </div>
  )
}
