'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { useToast } from '@/contexts/ToastContext'
import type { CatalogActivityDTO } from '@/lib/catalog/payload'

export interface LaborOption { id: string; name: string }
export interface MaterialOption { id: string; name: string; unit: string }

type LineType = 'MEASURED' | 'LUMPSUM'
interface RateLine { key: string; id: string; value: string }
interface SubDraft { key: string; name: string; type: LineType; lumpsum: string; manpower: RateLine[]; materials: RateLine[] }
interface EditorState {
  id?: string
  name: string
  type: LineType
  unit: string
  description: string
  lumpsum: string
  detailed: boolean
  flatManpower: RateLine[]
  flatMaterials: RateLine[]
  subs: SubDraft[]
}

function bhd(n: number): string {
  return `BHD ${n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`
}

let idc = 0
const nextKey = () => `k${idc++}`

function emptyEditor(): EditorState {
  return { name: '', type: 'MEASURED', unit: '', description: '', lumpsum: '', detailed: false, flatManpower: [], flatMaterials: [], subs: [] }
}

function toEditor(a: CatalogActivityDTO): EditorState {
  const implicit = a.subActivities.find((s) => s.isImplicit)
  const named = a.subActivities.filter((s) => !s.isImplicit)
  const toLines = (rows: { laborCategoryId?: string; materialId?: string; hoursPerUnit?: number; qtyPerUnit?: number }[], kind: 'm' | 'x'): RateLine[] =>
    rows.map((r) => ({ key: nextKey(), id: (kind === 'm' ? r.laborCategoryId : r.materialId) ?? '', value: String((kind === 'm' ? r.hoursPerUnit : r.qtyPerUnit) ?? '') }))
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    unit: a.unit ?? '',
    description: a.description ?? '',
    lumpsum: a.lumpsumBhd != null ? String(a.lumpsumBhd) : '',
    detailed: named.length > 0,
    flatManpower: implicit ? toLines(implicit.manpowerRates, 'm') : [],
    flatMaterials: implicit ? toLines(implicit.materialRates, 'x') : [],
    subs: named.map((s) => ({
      key: nextKey(),
      name: s.name,
      type: s.type,
      lumpsum: s.lumpsumBhd != null ? String(s.lumpsumBhd) : '',
      manpower: toLines(s.manpowerRates, 'm'),
      materials: toLines(s.materialRates, 'x'),
    })),
  }
}

function manpowerPayload(lines: RateLine[]) {
  return lines.filter((l) => l.id && Number(l.value) > 0).map((l) => ({ laborCategoryId: l.id, hoursPerUnit: Number(l.value) }))
}
function materialPayload(lines: RateLine[]) {
  return lines.filter((l) => l.id && Number(l.value) > 0).map((l) => ({ materialId: l.id, qtyPerUnit: Number(l.value) }))
}

function buildPayload(s: EditorState): Record<string, unknown> {
  if (s.type === 'LUMPSUM') {
    return { name: s.name.trim(), type: 'LUMPSUM', lumpsumBhd: Number(s.lumpsum), description: s.description.trim() || null }
  }
  const base: Record<string, unknown> = { name: s.name.trim(), type: 'MEASURED', unit: s.unit.trim(), description: s.description.trim() || null }
  if (s.detailed) {
    base.subActivities = s.subs.map((sub) =>
      sub.type === 'LUMPSUM'
        ? { name: sub.name.trim(), type: 'LUMPSUM', lumpsumBhd: Number(sub.lumpsum) }
        : { name: sub.name.trim(), type: 'MEASURED', manpowerRates: manpowerPayload(sub.manpower), materialRates: materialPayload(sub.materials) },
    )
  } else {
    base.activityRates = { manpowerRates: manpowerPayload(s.flatManpower), materialRates: materialPayload(s.flatMaterials) }
  }
  return base
}

export function CatalogActivityManager({
  initial,
  laborOptions,
  materialOptions,
}: {
  initial: CatalogActivityDTO[]
  laborOptions: LaborOption[]
  materialOptions: MaterialOption[]
}) {
  const router = useRouter()
  const { showToast } = useToast()
  const [busy, setBusy] = useState(false)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const savingRef = useRef(false)

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

  async function save() {
    if (!editor || savingRef.current) return
    if (!editor.name.trim()) return showToast('Name is required.', 'error')
    if (editor.type === 'MEASURED' && !editor.unit.trim()) return showToast('A measured activity needs a unit.', 'error')
    if (editor.type === 'LUMPSUM' && !(Number(editor.lumpsum) > 0)) return showToast('Enter a BHD amount greater than 0.', 'error')
    if (editor.type === 'MEASURED' && editor.detailed) {
      if (editor.subs.length === 0) return showToast('Add at least one sub-activity, or switch off "break into sub-activities".', 'error')
      if (editor.subs.some((s) => !s.name.trim())) return showToast('Every sub-activity needs a name.', 'error')
      if (editor.subs.some((s) => s.type === 'LUMPSUM' && !(Number(s.lumpsum) > 0))) return showToast('Every lumpsum sub-activity needs a BHD amount.', 'error')
    }
    savingRef.current = true
    const payload = buildPayload(editor)
    const ok = editor.id
      ? await call('PATCH', `/api/catalogs/activities/${editor.id}`, payload)
      : await call('POST', '/api/catalogs/activities', payload)
    savingRef.current = false
    if (ok) {
      setEditor(null)
      showToast(editor.id ? 'Activity updated.' : 'Activity created.', 'success')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-fg-subtle">Reusable activity templates with built-in budgets. Placing one on a project freezes a copy.</p>
        <Button size="sm" onClick={() => setEditor(emptyEditor())}>New activity</Button>
      </div>

      {initial.length === 0 ? (
        <EmptyState title="No catalog activities yet" description="Create a measured activity (labour + material rates) or a lumpsum activity." />
      ) : (
        <div className="space-y-2">
          {initial.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3">
              <div className="min-w-0 flex-1">
                <span className="font-medium text-fg">{a.name}</span>
                <Badge tone={a.type === 'LUMPSUM' ? 'warning' : 'neutral'} className="ml-2">{a.type === 'LUMPSUM' ? 'lumpsum' : 'measured'}</Badge>
                {!a.isActive && <Badge tone="neutral" className="ml-2">inactive</Badge>}
                <span className="ml-2 text-xs text-fg-subtle">
                  {a.type === 'LUMPSUM'
                    ? a.lumpsumBhd != null ? bhd(a.lumpsumBhd) : ''
                    : `${a.unit ?? ''}${a.subActivities.filter((s) => !s.isImplicit).length > 0 ? ` · ${a.subActivities.filter((s) => !s.isImplicit).length} sub-activities` : ''}`}
                </span>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setEditor(toEditor(a))}>Edit</Button>
              <Button size="sm" variant="ghost" onClick={() => call('PATCH', `/api/catalogs/activities/${a.id}`, { isActive: !a.isActive })}>
                {a.isActive ? 'Deactivate' : 'Activate'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { if (confirm(`Delete "${a.name}"? Existing placements keep their frozen budget.`)) call('DELETE', `/api/catalogs/activities/${a.id}`) }}
              >
                Delete
              </Button>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!editor} onClose={() => setEditor(null)} title={editor?.id ? 'Edit catalog activity' : 'New catalog activity'}>
        {editor && (
          <ActivityEditor
            state={editor}
            setState={setEditor}
            laborOptions={laborOptions}
            materialOptions={materialOptions}
            busy={busy}
            onSave={save}
            onCancel={() => setEditor(null)}
          />
        )}
      </Modal>
    </div>
  )
}

function RateEditor({
  title,
  options,
  lines,
  onChange,
  unitLabel,
}: {
  title: string
  options: { id: string; name: string }[]
  lines: RateLine[]
  onChange: (lines: RateLine[]) => void
  unitLabel: string
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{title}</p>
      {lines.map((line, i) => (
        <div key={line.key} className="flex items-center gap-2">
          <select
            value={line.id}
            onChange={(e) => onChange(lines.map((l, j) => (j === i ? { ...l, id: e.target.value } : l)))}
            className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-fg"
          >
            <option value="">Select…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={line.value}
            onChange={(e) => onChange(lines.map((l, j) => (j === i ? { ...l, value: e.target.value } : l)))}
            placeholder={unitLabel}
            className="w-28 rounded-md border border-border bg-surface px-2 py-1.5 text-sm tabular-nums text-fg"
          />
          <button type="button" onClick={() => onChange(lines.filter((_, j) => j !== i))} className="text-fg-subtle hover:text-danger" aria-label="Remove line">✕</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...lines, { key: nextKey(), id: '', value: '' }])} className="text-xs font-medium text-primary hover:underline">
        + Add {title.toLowerCase()} line
      </button>
    </div>
  )
}

function ActivityEditor({
  state,
  setState,
  laborOptions,
  materialOptions,
  busy,
  onSave,
  onCancel,
}: {
  state: EditorState
  setState: (s: EditorState) => void
  laborOptions: LaborOption[]
  materialOptions: MaterialOption[]
  busy: boolean
  onSave: () => void
  onCancel: () => void
}) {
  const set = (patch: Partial<EditorState>) => setState({ ...state, ...patch })

  return (
    <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
      <Input label="Name" value={state.name} onChange={(e) => set({ name: e.target.value })} placeholder="EIFS" />

      <div>
        <label className="mb-1 block text-sm font-medium text-fg">Type</label>
        <div className="flex gap-1 rounded-md border border-border bg-surface p-1">
          {(['MEASURED', 'LUMPSUM'] as LineType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => set({ type: t })}
              className={`flex-1 rounded px-3 py-1.5 text-sm font-medium ${state.type === t ? 'bg-primary-50 text-primary-700' : 'text-fg-muted'}`}
            >
              {t === 'MEASURED' ? 'Measured' : 'Lumpsum'}
            </button>
          ))}
        </div>
      </div>

      {state.type === 'MEASURED' ? (
        <>
          <Input label="Unit" value={state.unit} onChange={(e) => set({ unit: e.target.value })} placeholder="m2" />

          <label className="flex items-center gap-2 text-sm text-fg">
            <input type="checkbox" checked={state.detailed} onChange={(e) => set({ detailed: e.target.checked })} />
            Break into sub-activities
          </label>

          {state.detailed ? (
            <div className="space-y-3">
              {state.subs.map((sub, i) => (
                <div key={sub.key} className="space-y-2 rounded-md border border-border p-3">
                  <div className="flex items-center gap-2">
                    <Input label="Sub-activity" value={sub.name} onChange={(e) => set({ subs: state.subs.map((s, j) => (j === i ? { ...s, name: e.target.value } : s)) })} placeholder="Base coat + mesh" />
                    <button type="button" onClick={() => set({ subs: state.subs.filter((_, j) => j !== i) })} className="mt-6 text-fg-subtle hover:text-danger" aria-label="Remove sub-activity">✕</button>
                  </div>
                  <div className="flex gap-1 rounded-md border border-border bg-surface p-1">
                    {(['MEASURED', 'LUMPSUM'] as LineType[]).map((t) => (
                      <button key={t} type="button" onClick={() => set({ subs: state.subs.map((s, j) => (j === i ? { ...s, type: t } : s)) })} className={`flex-1 rounded px-2 py-1 text-xs font-medium ${sub.type === t ? 'bg-primary-50 text-primary-700' : 'text-fg-muted'}`}>
                        {t === 'MEASURED' ? 'Measured' : 'Lumpsum'}
                      </button>
                    ))}
                  </div>
                  {sub.type === 'LUMPSUM' ? (
                    <Input label="Lumpsum (BHD)" type="number" inputMode="decimal" min={0} step="any" value={sub.lumpsum} onChange={(e) => set({ subs: state.subs.map((s, j) => (j === i ? { ...s, lumpsum: e.target.value } : s)) })} />
                  ) : (
                    <>
                      <RateEditor title="Manpower" options={laborOptions} lines={sub.manpower} unitLabel="hrs/unit" onChange={(lines) => set({ subs: state.subs.map((s, j) => (j === i ? { ...s, manpower: lines } : s)) })} />
                      <RateEditor title="Materials" options={materialOptions} lines={sub.materials} unitLabel="qty/unit" onChange={(lines) => set({ subs: state.subs.map((s, j) => (j === i ? { ...s, materials: lines } : s)) })} />
                    </>
                  )}
                </div>
              ))}
              <Button size="sm" variant="secondary" onClick={() => set({ subs: [...state.subs, { key: nextKey(), name: '', type: 'MEASURED', lumpsum: '', manpower: [], materials: [] }] })}>+ Add sub-activity</Button>
            </div>
          ) : (
            <div className="space-y-3 rounded-md border border-border p-3">
              <p className="text-xs text-fg-subtle">Rates apply per {state.unit.trim() || 'unit'} of this activity.</p>
              <RateEditor title="Manpower" options={laborOptions} lines={state.flatManpower} unitLabel="hrs/unit" onChange={(lines) => set({ flatManpower: lines })} />
              <RateEditor title="Materials" options={materialOptions} lines={state.flatMaterials} unitLabel="qty/unit" onChange={(lines) => set({ flatMaterials: lines })} />
            </div>
          )}
        </>
      ) : (
        <Input label="Lumpsum (BHD)" type="number" inputMode="decimal" min={0} step="any" value={state.lumpsum} onChange={(e) => set({ lumpsum: e.target.value })} placeholder="2500.000" />
      )}

      <Input label="Description (optional)" value={state.description} onChange={(e) => set({ description: e.target.value })} />

      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button onClick={onSave} loading={busy}>Save</Button>
      </div>
    </div>
  )
}
