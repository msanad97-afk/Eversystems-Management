'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { useToast } from '@/contexts/ToastContext'

export interface ScopeActivityData {
  id: string
  ref: string | null
  name: string
  type: 'MEASURED' | 'LUMPSUM'
  unit: string | null
  boqQuantity: number
  lumpsumBhd: number | null
  lumpsumBillBhd: number | null
  costRate: number | null
  billRate: number | null
  pricedAt: string | null
  isActive: boolean
  sortOrder: number
  fromCatalog: boolean
  subActivityCount: number
}
export interface ScopeAssetData {
  id: string
  ref: string | null
  name: string
  description: string | null
  isActive: boolean
  sortOrder: number
  activities: ScopeActivityData[]
}
export interface CatalogOption {
  id: string
  name: string
  type: 'MEASURED' | 'LUMPSUM'
  unit: string | null
  lumpsumBhd: number | null
}

function bhd(n: number): string {
  return `BHD ${n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`
}

export function ScopeManager({
  projectId,
  assets,
  unitSuggestions,
  catalogOptions,
}: {
  projectId: string
  assets: ScopeAssetData[]
  unitSuggestions: string[]
  catalogOptions: CatalogOption[]
}) {
  const router = useRouter()
  const { showToast } = useToast()
  const [busy, setBusy] = useState(false)

  const [assetName, setAssetName] = useState('')
  const [assetRef, setAssetRef] = useState('')
  const [editAsset, setEditAsset] = useState<ScopeAssetData | null>(null)
  const [editActivity, setEditActivity] = useState<ScopeActivityData | null>(null)
  const [importResult, setImportResult] = useState<{ ok?: string; errors?: { row: number; message: string }[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function call(method: string, url: string, body?: unknown): Promise<boolean> {
    setBusy(true)
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong.')
      router.refresh()
      return true
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Something went wrong.', 'error')
      return false
    } finally {
      setBusy(false)
    }
  }

  /**
   * Re-price: re-snapshot current global cost rates onto this activity's frozen budget
   * rows. Since Phase 6B, actual cost is separately frozen at approval time — so this moves
   * ONLY the budget side of the comparison, which is exactly why it must be spelled out.
   */
  async function reprice(act: ScopeActivityData) {
    const priced = act.pricedAt ? new Date(act.pricedAt).toLocaleDateString() : 'never'
    const ok = confirm(
      `Re-price "${act.name}"?\n\n` +
        `Its budget cost rates were last frozen: ${priced}.\n\n` +
        `This re-prices the BUDGET at today's catalog rates. Actual cost is NOT affected — ` +
        `it stays frozen at the rates in force when each report was approved.\n\n` +
        `So this shifts the budget baseline only: cost variance and CPI for this activity will ` +
        `move even though nothing about the work already done has changed. ` +
        `Every old→new rate is recorded in the audit log.`,
    )
    if (!ok) return
    setBusy(true)
    try {
      const res = await fetch(`/api/activities/${act.id}/reprice`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not re-price.')
      router.refresh()
      showToast(data.changes?.length ? `Re-priced — ${data.changes.length} rate(s) changed.` : 'Already at current rates.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not re-price.', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function addAsset() {
    if (!assetName.trim()) return
    if (await call('POST', `/api/projects/${projectId}/assets`, { name: assetName.trim(), ref: assetRef.trim() || null })) {
      setAssetName('')
      setAssetRef('')
      showToast('Asset added.', 'success')
    }
  }

  async function move(kind: 'assets' | 'activities', list: { id: string; sortOrder: number }[], index: number, dir: -1 | 1) {
    const target = index + dir
    if (target < 0 || target >= list.length) return
    const a = list[index]!
    const b = list[target]!
    await Promise.all([
      call('PATCH', `/api/${kind}/${a.id}`, { sortOrder: b.sortOrder }),
      call('PATCH', `/api/${kind}/${b.id}`, { sortOrder: a.sortOrder }),
    ])
  }

  async function onImport() {
    const file = fileRef.current?.files?.[0]
    if (!file) return
    setImportResult(null)
    const csv = await file.text()
    setBusy(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/boq-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setImportResult({ errors: data.errors ?? [{ row: 0, message: data.error ?? 'Import failed.' }] })
        return
      }
      setImportResult({ ok: `Imported ${data.createdActivities} activities across ${data.createdAssets} new asset(s).` })
      if (fileRef.current) fileRef.current.value = ''
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Scope — assets &amp; activities</h2>

      {/* BOQ import */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="text-sm font-medium text-fg">Import BOQ (CSV)</p>
        <p className="mt-1 text-xs text-fg-subtle">
          Columns: asset, activity ref, activity name, unit, boq quantity. Assets are created as needed.
        </p>
        <p className="mt-1 text-xs font-medium text-warning">
          Measured activities only — lumpsum lines and catalog budgets can&apos;t be imported; add those below.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="text-sm" />
          <Button variant="secondary" size="sm" onClick={onImport} loading={busy}>Import</Button>
        </div>
        {importResult?.ok && <p className="mt-2 text-sm text-success">{importResult.ok}</p>}
        {importResult?.errors && (
          <div className="mt-2 rounded-md border border-danger bg-danger-bg px-3 py-2 text-sm text-danger">
            <p className="font-semibold">Nothing was imported. Fix these rows:</p>
            <ul className="mt-1 space-y-0.5">
              {importResult.errors.slice(0, 20).map((e, i) => (
                <li key={i}>Row {e.row}: {e.message}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Add asset */}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface p-4">
        <div className="min-w-[45%] flex-1">
          <Input label="New asset" value={assetName} onChange={(e) => setAssetName(e.target.value)} placeholder="e.g. Tower A" />
        </div>
        <div className="w-28">
          <Input label="Ref (optional)" value={assetRef} onChange={(e) => setAssetRef(e.target.value)} placeholder="A" />
        </div>
        <Button onClick={addAsset} loading={busy} disabled={!assetName.trim()}>Add asset</Button>
      </div>

      {assets.length === 0 ? (
        <EmptyState title="No assets yet" description="Add an asset (or import a BOQ) so this project can receive reports." />
      ) : (
        <div className="space-y-3">
          {assets.map((asset, ai) => (
            <div key={asset.id} className="rounded-lg border border-border bg-surface">
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <ReorderButtons onUp={() => move('assets', assets, ai, -1)} onDown={() => move('assets', assets, ai, 1)} first={ai === 0} last={ai === assets.length - 1} />
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-fg">{asset.name}</span>
                  {asset.ref && <span className="mono ml-2 text-xs text-fg-subtle">{asset.ref}</span>}
                  {!asset.isActive && <Badge tone="neutral" className="ml-2">inactive</Badge>}
                </div>
                <Button size="sm" variant="ghost" onClick={() => setEditAsset(asset)}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => call('PATCH', `/api/assets/${asset.id}`, { isActive: !asset.isActive })}>
                  {asset.isActive ? 'Deactivate' : 'Activate'}
                </Button>
              </div>

              <div className="px-4 py-2">
                {asset.activities.length === 0 ? (
                  <p className="py-2 text-sm text-fg-subtle">No activities yet.</p>
                ) : (
                  <div className="divide-y divide-border">
                    {asset.activities.map((act, xi) => (
                      <div key={act.id} className="flex items-center gap-2 py-2">
                        <ReorderButtons onUp={() => move('activities', asset.activities, xi, -1)} onDown={() => move('activities', asset.activities, xi, 1)} first={xi === 0} last={xi === asset.activities.length - 1} />
                        <div className="min-w-0 flex-1">
                          <span className="text-sm text-fg">{act.ref ? `${act.ref} · ` : ''}{act.name}</span>
                          {act.type === 'LUMPSUM' ? (
                            <span className="ml-2 text-xs text-fg-subtle">{act.lumpsumBhd != null ? bhd(act.lumpsumBhd) : 'lumpsum'}</span>
                          ) : (
                            <span className="ml-2 text-xs text-fg-subtle">BOQ {act.boqQuantity} {act.unit ?? ''}</span>
                          )}
                          {act.type === 'LUMPSUM' && <Badge tone="warning" className="ml-2">lumpsum</Badge>}
                          {act.fromCatalog && <Badge tone="info" className="ml-2">catalog</Badge>}
                          {act.subActivityCount > 0 && <Badge tone="neutral" className="ml-2">{act.subActivityCount} sub</Badge>}
                          {!act.isActive && <Badge tone="neutral" className="ml-2">inactive</Badge>}
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => setEditActivity(act)}>Edit</Button>
                        <Button size="sm" variant="ghost" onClick={() => reprice(act)}>Re-price</Button>
                        <Button size="sm" variant="ghost" onClick={() => call('PATCH', `/api/activities/${act.id}`, { isActive: !act.isActive })}>
                          {act.isActive ? 'Deactivate' : 'Activate'}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                <AddActivity
                  assetId={asset.id}
                  unitSuggestions={unitSuggestions}
                  catalogOptions={catalogOptions}
                  onAdd={(body) => call('POST', `/api/assets/${asset.id}/activities`, body)}
                  busy={busy}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit asset */}
      <Modal open={!!editAsset} onClose={() => setEditAsset(null)} title="Edit asset">
        {editAsset && (
          <EditAssetForm
            asset={editAsset}
            busy={busy}
            onSave={async (body) => {
              if (await call('PATCH', `/api/assets/${editAsset.id}`, body)) setEditAsset(null)
            }}
            onCancel={() => setEditAsset(null)}
          />
        )}
      </Modal>

      {/* Edit activity */}
      <Modal open={!!editActivity} onClose={() => setEditActivity(null)} title="Edit activity">
        {editActivity && (
          <EditActivityForm
            activity={editActivity}
            unitSuggestions={unitSuggestions}
            busy={busy}
            onSave={async (body) => {
              if (await call('PATCH', `/api/activities/${editActivity.id}`, body)) setEditActivity(null)
            }}
            onCancel={() => setEditActivity(null)}
          />
        )}
      </Modal>
    </div>
  )
}

function ReorderButtons({ onUp, onDown, first, last }: { onUp: () => void; onDown: () => void; first: boolean; last: boolean }) {
  return (
    <div className="flex flex-col text-fg-subtle">
      <button type="button" onClick={onUp} disabled={first} className="disabled:opacity-30" aria-label="Move up">▲</button>
      <button type="button" onClick={onDown} disabled={last} className="disabled:opacity-30" aria-label="Move down">▼</button>
    </div>
  )
}

function UnitInput({ value, onChange, unitSuggestions }: { value: string; onChange: (v: string) => void; unitSuggestions: string[] }) {
  return (
    <>
      <Input label="Unit" value={value} onChange={(e) => onChange(e.target.value)} list="unit-suggestions" placeholder="m2" />
      <datalist id="unit-suggestions">
        {unitSuggestions.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
    </>
  )
}

type AddMode = 'measured' | 'lumpsum' | 'catalog'

function AddActivity({
  assetId,
  unitSuggestions,
  catalogOptions,
  onAdd,
  busy,
}: {
  assetId: string
  unitSuggestions: string[]
  catalogOptions: CatalogOption[]
  onAdd: (body: Record<string, unknown>) => Promise<boolean>
  busy: boolean
}) {
  const [mode, setMode] = useState<AddMode>('measured')
  const [name, setName] = useState('')
  const [ref, setRef] = useState('')
  const [unit, setUnit] = useState('')
  const [boq, setBoq] = useState('')
  const [lumpsum, setLumpsum] = useState('')
  const [catalogId, setCatalogId] = useState('')

  const selectedCatalog = catalogOptions.find((c) => c.id === catalogId) ?? null

  function reset() {
    setName(''); setRef(''); setUnit(''); setBoq(''); setLumpsum(''); setCatalogId('')
  }

  const valid =
    mode === 'measured'
      ? name.trim() && unit.trim() && Number(boq) > 0
      : mode === 'lumpsum'
        ? name.trim() && Number(lumpsum) > 0
        : !!selectedCatalog && (selectedCatalog.type === 'MEASURED' ? Number(boq) > 0 : true)

  async function submit() {
    if (!valid) return
    let body: Record<string, unknown>
    if (mode === 'measured') {
      body = { type: 'MEASURED', name: name.trim(), ref: ref.trim() || null, unit: unit.trim(), boqQuantity: Number(boq) }
    } else if (mode === 'lumpsum') {
      body = { type: 'LUMPSUM', name: name.trim(), ref: ref.trim() || null, lumpsumBhd: Number(lumpsum) }
    } else {
      body = {
        catalogActivityId: selectedCatalog!.id,
        ref: ref.trim() || null,
        ...(selectedCatalog!.type === 'MEASURED' ? { boqQuantity: Number(boq) } : {}),
        ...(selectedCatalog!.type === 'LUMPSUM' && lumpsum.trim() ? { lumpsumBhd: Number(lumpsum) } : {}),
      }
    }
    if (await onAdd(body)) reset()
  }

  return (
    <div className="mt-2 space-y-2 border-t border-border pt-3">
      <div className="flex flex-wrap gap-1">
        {(['measured', 'lumpsum', 'catalog'] as AddMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => { setMode(m); reset() }}
            disabled={m === 'catalog' && catalogOptions.length === 0}
            className={`rounded-md px-2.5 py-1 text-xs font-medium disabled:opacity-40 ${mode === m ? 'bg-primary-50 text-primary-700' : 'text-fg-muted'}`}
          >
            {m === 'measured' ? 'One-off measured' : m === 'lumpsum' ? 'One-off lumpsum' : 'From catalog'}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="w-20">
          <Input label="Ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="3.2.1" />
        </div>

        {mode === 'catalog' ? (
          <>
            <div className="min-w-[35%] flex-1">
              <label className="mb-1 block text-sm font-medium text-fg">Catalog activity</label>
              <select
                value={catalogId}
                onChange={(e) => setCatalogId(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg"
              >
                <option value="">Select…</option>
                {catalogOptions.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.type === 'MEASURED' ? c.unit ?? 'measured' : 'lumpsum'})</option>
                ))}
              </select>
            </div>
            {selectedCatalog?.type === 'MEASURED' && (
              <div className="w-24">
                <Input label={`BOQ qty${selectedCatalog.unit ? ` (${selectedCatalog.unit})` : ''}`} type="number" inputMode="decimal" min={0} step="any" value={boq} onChange={(e) => setBoq(e.target.value)} />
              </div>
            )}
            {selectedCatalog?.type === 'LUMPSUM' && (
              <div className="w-32">
                <Input label="BHD (override)" type="number" inputMode="decimal" min={0} step="any" value={lumpsum} onChange={(e) => setLumpsum(e.target.value)} placeholder={selectedCatalog.lumpsumBhd != null ? String(selectedCatalog.lumpsumBhd) : ''} />
              </div>
            )}
          </>
        ) : (
          <>
            <div className="min-w-[35%] flex-1">
              <Input label="Activity" value={name} onChange={(e) => setName(e.target.value)} placeholder={mode === 'lumpsum' ? 'Scaffolding' : 'Blockwork 200mm'} />
            </div>
            {mode === 'measured' ? (
              <>
                <div className="w-24"><UnitInput value={unit} onChange={setUnit} unitSuggestions={unitSuggestions} /></div>
                <div className="w-24">
                  <Input label="BOQ qty" type="number" inputMode="decimal" min={0} step="any" value={boq} onChange={(e) => setBoq(e.target.value)} />
                </div>
              </>
            ) : (
              <div className="w-32">
                <Input label="BHD amount" type="number" inputMode="decimal" min={0} step="any" value={lumpsum} onChange={(e) => setLumpsum(e.target.value)} />
              </div>
            )}
          </>
        )}

        <Button size="sm" onClick={submit} loading={busy} disabled={!valid} aria-label={`Add activity to asset ${assetId}`}>Add</Button>
      </div>
    </div>
  )
}

function EditAssetForm({ asset, busy, onSave, onCancel }: { asset: ScopeAssetData; busy: boolean; onSave: (b: { name: string; ref: string | null; description: string | null }) => void; onCancel: () => void }) {
  const [name, setName] = useState(asset.name)
  const [ref, setRef] = useState(asset.ref ?? '')
  const [description, setDescription] = useState(asset.description ?? '')
  return (
    <div className="space-y-3">
      <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <Input label="Ref (optional)" value={ref} onChange={(e) => setRef(e.target.value)} />
      <Input label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button onClick={() => onSave({ name: name.trim(), ref: ref.trim() || null, description: description.trim() || null })} loading={busy} disabled={!name.trim()}>Save</Button>
      </div>
    </div>
  )
}

function EditActivityForm({ activity, unitSuggestions, busy, onSave, onCancel }: { activity: ScopeActivityData; unitSuggestions: string[]; busy: boolean; onSave: (b: Record<string, unknown>) => void; onCancel: () => void }) {
  const [name, setName] = useState(activity.name)
  const [ref, setRef] = useState(activity.ref ?? '')
  const [unit, setUnit] = useState(activity.unit ?? '')
  const [boq, setBoq] = useState(String(activity.boqQuantity))
  const [lumpsum, setLumpsum] = useState(activity.lumpsumBhd != null ? String(activity.lumpsumBhd) : '')
  const [lumpsumBill, setLumpsumBill] = useState(activity.lumpsumBillBhd != null ? String(activity.lumpsumBillBhd) : '')
  const [costRate, setCostRate] = useState(activity.costRate != null ? String(activity.costRate) : '')
  const [billRate, setBillRate] = useState(activity.billRate != null ? String(activity.billRate) : '')

  const money = (v: string) => (v.trim() === '' ? null : Number(v))

  const valid =
    activity.type === 'LUMPSUM'
      ? name.trim() && Number(lumpsum) > 0
      : name.trim() && unit.trim() && Number(boq) > 0

  function save() {
    if (activity.type === 'LUMPSUM') {
      onSave({ name: name.trim(), ref: ref.trim() || null, lumpsumBhd: Number(lumpsum), lumpsumBillBhd: money(lumpsumBill) })
    } else {
      onSave({
        name: name.trim(), ref: ref.trim() || null, unit: unit.trim(), boqQuantity: Number(boq),
        costRate: money(costRate), billRate: money(billRate),
      })
    }
  }

  return (
    <div className="space-y-3">
      <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <Input label="Ref (optional)" value={ref} onChange={(e) => setRef(e.target.value)} />
      {activity.type === 'LUMPSUM' ? (
        <>
          <Input label="Lumpsum cost (BHD)" type="number" inputMode="decimal" min={0} step="any" value={lumpsum} onChange={(e) => setLumpsum(e.target.value)} />
          <Input label="Contract value (BHD)" type="number" inputMode="decimal" min={0} step="any" value={lumpsumBill} onChange={(e) => setLumpsumBill(e.target.value)} hint="Leave blank to bill at cost." />
        </>
      ) : (
        <>
          <UnitInput value={unit} onChange={setUnit} unitSuggestions={unitSuggestions} />
          <Input label="BOQ quantity" type="number" inputMode="decimal" min={0} step="any" value={boq} onChange={(e) => setBoq(e.target.value)} hint="Lowering below earned-to-date is allowed; history is preserved." />
          <Input label="Cost rate (BHD/unit)" type="number" inputMode="decimal" min={0} step="any" value={costRate} onChange={(e) => setCostRate(e.target.value)} hint="Only used when the activity has no labour/material build-up." />
          <Input label="Bill rate (BHD/unit)" type="number" inputMode="decimal" min={0} step="any" value={billRate} onChange={(e) => setBillRate(e.target.value)} hint="Contract value per unit — the revenue source." />
        </>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button onClick={save} loading={busy} disabled={!valid}>Save</Button>
      </div>
    </div>
  )
}
