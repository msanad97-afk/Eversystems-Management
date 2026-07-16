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
  unit: string
  boqQuantity: number
  isActive: boolean
  sortOrder: number
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

export function ScopeManager({
  projectId,
  assets,
  unitSuggestions,
}: {
  projectId: string
  assets: ScopeAssetData[]
  unitSuggestions: string[]
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
                          <span className="ml-2 text-xs text-fg-subtle">BOQ {act.boqQuantity} {act.unit}</span>
                          {!act.isActive && <Badge tone="neutral" className="ml-2">inactive</Badge>}
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => setEditActivity(act)}>Edit</Button>
                        <Button size="sm" variant="ghost" onClick={() => call('PATCH', `/api/activities/${act.id}`, { isActive: !act.isActive })}>
                          {act.isActive ? 'Deactivate' : 'Activate'}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                <AddActivity assetId={asset.id} unitSuggestions={unitSuggestions} onAdd={(body) => call('POST', `/api/assets/${asset.id}/activities`, body)} busy={busy} />
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

function AddActivity({
  assetId,
  unitSuggestions,
  onAdd,
  busy,
}: {
  assetId: string
  unitSuggestions: string[]
  onAdd: (body: { name: string; ref: string | null; unit: string; boqQuantity: number }) => Promise<boolean>
  busy: boolean
}) {
  const [name, setName] = useState('')
  const [ref, setRef] = useState('')
  const [unit, setUnit] = useState('')
  const [boq, setBoq] = useState('')
  const valid = name.trim() && unit.trim() && Number(boq) > 0

  async function submit() {
    if (!valid) return
    if (await onAdd({ name: name.trim(), ref: ref.trim() || null, unit: unit.trim(), boqQuantity: Number(boq) })) {
      setName(''); setRef(''); setUnit(''); setBoq('')
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-border pt-3">
      <div className="w-20">
        <Input label="Ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="3.2.1" />
      </div>
      <div className="min-w-[35%] flex-1">
        <Input label="Activity" value={name} onChange={(e) => setName(e.target.value)} placeholder="Blockwork 200mm" />
      </div>
      <div className="w-24"><UnitInput value={unit} onChange={setUnit} unitSuggestions={unitSuggestions} /></div>
      <div className="w-24">
        <Input label="BOQ qty" type="number" inputMode="decimal" min={0} step="any" value={boq} onChange={(e) => setBoq(e.target.value)} />
      </div>
      <Button size="sm" onClick={submit} loading={busy} disabled={!valid} aria-label={`Add activity to asset ${assetId}`}>Add</Button>
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

function EditActivityForm({ activity, unitSuggestions, busy, onSave, onCancel }: { activity: ScopeActivityData; unitSuggestions: string[]; busy: boolean; onSave: (b: { name: string; ref: string | null; unit: string; boqQuantity: number }) => void; onCancel: () => void }) {
  const [name, setName] = useState(activity.name)
  const [ref, setRef] = useState(activity.ref ?? '')
  const [unit, setUnit] = useState(activity.unit)
  const [boq, setBoq] = useState(String(activity.boqQuantity))
  const valid = name.trim() && unit.trim() && Number(boq) > 0
  return (
    <div className="space-y-3">
      <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <Input label="Ref (optional)" value={ref} onChange={(e) => setRef(e.target.value)} />
      <UnitInput value={unit} onChange={setUnit} unitSuggestions={unitSuggestions} />
      <Input label="BOQ quantity" type="number" inputMode="decimal" min={0} step="any" value={boq} onChange={(e) => setBoq(e.target.value)} hint="Lowering below earned-to-date is allowed; history is preserved." />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button onClick={() => onSave({ name: name.trim(), ref: ref.trim() || null, unit: unit.trim(), boqQuantity: Number(boq) })} loading={busy} disabled={!valid}>Save</Button>
      </div>
    </div>
  )
}
