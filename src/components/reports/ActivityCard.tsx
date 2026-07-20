'use client'

import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import {
  type ActivityRow,
  type SubRow,
  type ManRow,
  type MatRow,
  type AssetOption,
  type ActivityOption,
  type SubActivityOption,
  type CategoryOption,
  type MaterialOption,
  newKey,
} from '@/components/reports/formTypes'

function findActivity(assets: AssetOption[], activityId: string): ActivityOption | undefined {
  for (const a of assets) {
    const act = a.activities.find((x) => x.id === activityId)
    if (act) return act
  }
  return undefined
}
function assetOf(assets: AssetOption[], activityId: string): AssetOption | undefined {
  return assets.find((a) => a.activities.some((x) => x.id === activityId))
}

/** Seed manpower/material rows from the snapshotted budget (identities pre-filled, numbers blank). */
export function prefillRows(opt: SubActivityOption): { manpower: ManRow[]; materials: MatRow[] } {
  return {
    manpower: opt.budgetManpower.map((b) => ({ key: newKey(), categoryId: b.categoryId, headcount: '', hours: '' })),
    materials: opt.budgetMaterials.map((b) => ({ key: newKey(), materialId: b.materialId, quantity: '' })),
  }
}

export function emptySub(opt: SubActivityOption, included: boolean): SubRow {
  const pre = included ? prefillRows(opt) : { manpower: [], materials: [] }
  return { key: newKey(), subActivityId: opt.id, included, quantityDone: '', percentComplete: '', note: '', ...pre }
}
/** Alias used by ReportForm for building initial/copied rows. */
export const emptySubHelper = emptySub

/** Build the sub-rows for a freshly-picked activity: implicit → one auto-included line; named → all off. */
export function subsForActivity(act: ActivityOption): SubRow[] {
  const onlyImplicit = act.subActivities.length === 1 && act.subActivities[0]!.isImplicit
  return act.subActivities.map((s) => emptySub(s, onlyImplicit))
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
  onChange: (next: ActivityRow) => void
  onRemove: () => void
}) {
  const activity = findActivity(assets, row.activityId)
  const asset = assetOf(assets, row.activityId)
  const onlyImplicit = !!activity && activity.subActivities.length === 1 && activity.subActivities[0]!.isImplicit

  function pickActivity(activityId: string) {
    const act = findActivity(assets, activityId)
    onChange({ ...row, activityId, subs: act ? subsForActivity(act) : [] })
  }
  function updateSub(subActivityId: string, next: SubRow) {
    onChange({ ...row, subs: row.subs.map((s) => (s.subActivityId === subActivityId ? next : s)) })
  }
  function toggleSub(opt: SubActivityOption, on: boolean) {
    updateSub(opt.id, on ? emptySub(opt, true) : { ...emptySub(opt, false) })
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {row.activityId === '' ? (
            <Select label="Activity" value="" onChange={(e) => pickActivity(e.target.value)}>
              <option value="">Select an activity…</option>
              {assets.map((a) => (
                <optgroup key={a.id} label={a.name}>
                  {a.activities
                    .filter((act) => act.id === row.activityId || !usedActivityIds.has(act.id))
                    .map((act) => (
                      <option key={act.id} value={act.id}>
                        {act.ref ? `${act.ref} · ` : ''}{act.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </Select>
          ) : (
            <>
              <p className="text-sm font-semibold text-fg">{activity?.ref ? `${activity.ref} · ` : ''}{activity?.name}</p>
              <p className="text-xs text-fg-subtle">{asset?.name}{activity?.type === 'LUMPSUM' ? ' · lumpsum' : activity?.unit ? ` · ${activity.unit}` : ''}</p>
            </>
          )}
        </div>
        <button type="button" onClick={onRemove} className="text-fg-subtle hover:text-danger" aria-label="Remove activity">✕</button>
      </div>

      {activity && (
        <div className="mt-3 space-y-3">
          {activity.subActivities.map((opt) => {
            const sub = row.subs.find((s) => s.subActivityId === opt.id)
            if (!sub) return null
            if (onlyImplicit) {
              // Flat activity: render the single line inline, no sub-activity header.
              return <SubLine key={opt.id} opt={opt} sub={sub} categories={categories} materials={materials} onChange={(n) => updateSub(opt.id, n)} />
            }
            return (
              <div key={opt.id} className="rounded-md border border-border">
                <label className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-fg">
                  <input type="checkbox" checked={sub.included} onChange={(e) => toggleSub(opt, e.target.checked)} />
                  {opt.name}
                  <span className="text-xs font-normal text-fg-subtle">{opt.type === 'LUMPSUM' ? 'lumpsum' : ''}</span>
                </label>
                {sub.included && (
                  <div className="border-t border-border p-3">
                    <SubLine opt={opt} sub={sub} categories={categories} materials={materials} onChange={(n) => updateSub(opt.id, n)} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SubLine({
  opt,
  sub,
  categories,
  materials,
  onChange,
}: {
  opt: SubActivityOption
  sub: SubRow
  categories: CategoryOption[]
  materials: MaterialOption[]
  onChange: (next: SubRow) => void
}) {
  const earnedBhd =
    opt.type === 'LUMPSUM' && opt.lumpsumBhd != null && Number(sub.percentComplete) > 0
      ? ((Number(sub.percentComplete) / 100) * opt.lumpsumBhd).toFixed(3)
      : null

  return (
    <div className="space-y-3">
      {opt.type === 'LUMPSUM' ? (
        <div>
          <Input
            label="% complete (cumulative)"
            type="number" inputMode="decimal" min={opt.lastApprovedPercent} max={100} step="any"
            value={sub.percentComplete}
            onChange={(e) => onChange({ ...sub, percentComplete: e.target.value })}
            hint={`Last approved ${opt.lastApprovedPercent}%${opt.lumpsumBhd != null ? ` · budget BHD ${opt.lumpsumBhd.toLocaleString()}` : ''}${earnedBhd ? ` · earned BHD ${earnedBhd}` : ''}`}
          />
        </div>
      ) : (
        <div>
          <Input
            label="Quantity done today"
            type="number" inputMode="decimal" min={0} step="any"
            value={sub.quantityDone}
            onChange={(e) => onChange({ ...sub, quantityDone: e.target.value })}
            hint={`Remaining ${opt.remaining} of ${opt.boqQuantity}`}
          />
        </div>
      )}

      <ManpowerEditor rows={sub.manpower} categories={categories} onChange={(manpower) => onChange({ ...sub, manpower })} />
      <MaterialEditor rows={sub.materials} materials={materials} onChange={(rows) => onChange({ ...sub, materials: rows })} />
    </div>
  )
}

function ManpowerEditor({ rows, categories, onChange }: { rows: ManRow[]; categories: CategoryOption[]; onChange: (rows: ManRow[]) => void }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">Manpower</p>
      {rows.map((r, i) => (
        <div key={r.key} className="flex items-center gap-2">
          <select value={r.categoryId} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, categoryId: e.target.value } : x)))} className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-fg">
            <option value="">Trade…</option>
            {categories.map((c) => (<option key={c.id} value={c.id}>{c.name}{c.isActive ? '' : ' (inactive)'}</option>))}
          </select>
          <input type="number" inputMode="numeric" min={1} step={1} placeholder="No." value={r.headcount} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, headcount: e.target.value } : x)))} className="w-16 rounded-md border border-border bg-surface px-2 py-1.5 text-sm tabular-nums text-fg" />
          <input type="number" inputMode="decimal" min={0} step="any" placeholder="Hrs" value={r.hours} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, hours: e.target.value } : x)))} className="w-16 rounded-md border border-border bg-surface px-2 py-1.5 text-sm tabular-nums text-fg" />
          <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="text-fg-subtle hover:text-danger" aria-label="Remove manpower row">✕</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rows, { key: newKey(), categoryId: '', headcount: '', hours: '' }])} className="text-xs font-medium text-primary hover:underline">+ Add trade</button>
    </div>
  )
}

function MaterialEditor({ rows, materials, onChange }: { rows: MatRow[]; materials: MaterialOption[]; onChange: (rows: MatRow[]) => void }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">Materials</p>
      {rows.map((r, i) => {
        const mat = materials.find((m) => m.id === r.materialId)
        return (
          <div key={r.key} className="flex items-center gap-2">
            <select value={r.materialId} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, materialId: e.target.value } : x)))} className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-fg">
              <option value="">Material…</option>
              {materials.map((m) => (<option key={m.id} value={m.id}>{m.name}{m.isActive ? '' : ' (inactive)'}</option>))}
            </select>
            <input type="number" inputMode="decimal" min={0} step="any" placeholder="Qty" value={r.quantity} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} className="w-20 rounded-md border border-border bg-surface px-2 py-1.5 text-sm tabular-nums text-fg" />
            <span className="w-10 text-xs text-fg-subtle">{mat?.unit ?? ''}</span>
            <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="text-fg-subtle hover:text-danger" aria-label="Remove material row">✕</button>
          </div>
        )
      })}
      <button type="button" onClick={() => onChange([...rows, { key: newKey(), materialId: '', quantity: '' }])} className="text-xs font-medium text-primary hover:underline">+ Add material</button>
    </div>
  )
}
