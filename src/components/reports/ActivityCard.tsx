'use client'

import { useState } from 'react'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { ManpowerSection } from '@/components/reports/ManpowerSection'
import { MaterialsSection } from '@/components/reports/MaterialsSection'
import { cumulativePercent } from '@/lib/reports/rules'
import type {
  ActivityRow,
  AssetOption,
  ActivityOption,
  CategoryOption,
  MaterialOption,
} from '@/components/reports/formTypes'

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export function ActivityCard({
  row,
  assets,
  usedActivityIds,
  categories,
  materials,
  onChange,
  onRemove,
}: {
  row: ActivityRow
  assets: AssetOption[]
  usedActivityIds: Set<string>
  categories: CategoryOption[]
  materials: MaterialOption[]
  onChange: (row: ActivityRow) => void
  onRemove: () => void
}) {
  const selectedOption: ActivityOption | undefined = assets
    .flatMap((a) => a.activities)
    .find((x) => x.id === row.activityId)
  const owningAssetId = assets.find((a) => a.activities.some((x) => x.id === row.activityId))?.id ?? ''
  const [assetId, setAssetId] = useState(owningAssetId)

  const asset = assets.find((a) => a.id === assetId)
  const qty = Number(row.quantityDone)
  const hasQty = Number.isFinite(qty) && qty > 0
  const overCap = !!selectedOption && Number.isFinite(qty) && qty > selectedOption.remaining + 1e-6

  const patch = (p: Partial<ActivityRow>) => onChange({ ...row, ...p })

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
          <Select
            label="Asset"
            value={assetId}
            onChange={(e) => {
              setAssetId(e.target.value)
              patch({ activityId: '' })
            }}
          >
            <option value="">Select asset…</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
          <Select
            label="Activity"
            value={row.activityId}
            onChange={(e) => patch({ activityId: e.target.value })}
            disabled={!assetId}
          >
            <option value="">Select activity…</option>
            {asset?.activities.map((act) => (
              <option
                key={act.id}
                value={act.id}
                disabled={usedActivityIds.has(act.id) && act.id !== row.activityId}
              >
                {act.name} ({act.unit})
              </option>
            ))}
          </Select>
        </div>
        <button type="button" onClick={onRemove} className="mt-6 text-sm font-medium text-danger hover:underline">
          Remove
        </button>
      </div>

      {selectedOption && (
        <div className="mt-3 rounded-md bg-surface-subtle px-3 py-2 text-xs text-fg-muted">
          Unit {selectedOption.unit} · BOQ {selectedOption.boqQuantity} · Done to date{' '}
          {round1(selectedOption.earned)} ({round1(cumulativePercent(selectedOption.earned, selectedOption.boqQuantity))}%) ·{' '}
          <span className={overCap ? 'font-semibold text-danger' : ''}>Remaining {round1(selectedOption.remaining)}</span>
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <Input
            label={`Quantity done today${selectedOption ? ` (${selectedOption.unit})` : ''}`}
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={row.quantityDone}
            onChange={(e) => patch({ quantityDone: e.target.value })}
            error={overCap && selectedOption ? `Exceeds remaining ${round1(selectedOption.remaining)} ${selectedOption.unit}.` : undefined}
            hint={
              !overCap && hasQty && selectedOption
                ? `After today: ${round1(cumulativePercent(selectedOption.earned + qty, selectedOption.boqQuantity))}% complete`
                : undefined
            }
          />
        </div>
        <Input label="Note (optional)" value={row.note} onChange={(e) => patch({ note: e.target.value })} />
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Manpower</p>
          <ManpowerSection rows={row.manpower} categories={categories} onChange={(r) => patch({ manpower: r })} />
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Materials</p>
          <MaterialsSection rows={row.materials} materials={materials} onChange={(r) => patch({ materials: r })} />
        </div>
      </div>
    </div>
  )
}
