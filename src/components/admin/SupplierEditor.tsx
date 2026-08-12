'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { useToast } from '@/contexts/ToastContext'

export interface SupplierItem {
  id: string
  name: string
  contactName: string | null
  contactPhone: string | null
  contactEmail: string | null
  isActive: boolean
  materialCount: number
  createdAt: string
}

const ENDPOINT = '/api/catalogs/suppliers'

interface DraftFields {
  name: string
  contactName: string
  contactPhone: string
  contactEmail: string
}
const emptyDraft: DraftFields = { name: '', contactName: '', contactPhone: '', contactEmail: '' }

export function SupplierEditor({ initial }: { initial: SupplierItem[] }) {
  const router = useRouter()
  const { showToast } = useToast()
  const [items, setItems] = useState<SupplierItem[]>(initial)
  const [draft, setDraft] = useState<DraftFields>(emptyDraft)
  const [adding, setAdding] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [edit, setEdit] = useState<DraftFields>(emptyDraft)

  async function call(method: 'POST' | 'PATCH', body: unknown): Promise<SupplierItem | null> {
    const res = await fetch(ENDPOINT, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { showToast(data.error ?? 'Something went wrong.', 'error'); return null }
    router.refresh()
    return data.supplier as SupplierItem
  }

  async function add() {
    if (!draft.name.trim()) return
    setAdding(true)
    const created = await call('POST', {
      name: draft.name.trim(), contactName: draft.contactName.trim() || null,
      contactPhone: draft.contactPhone.trim() || null, contactEmail: draft.contactEmail.trim() || null,
    })
    if (created) { setItems((prev) => [...prev, created]); setDraft(emptyDraft); showToast('Supplier added.', 'success') }
    setAdding(false)
  }

  async function saveEdit(id: string) {
    const updated = await call('PATCH', {
      id, name: edit.name.trim(), contactName: edit.contactName.trim() || null,
      contactPhone: edit.contactPhone.trim() || null, contactEmail: edit.contactEmail.trim() || null,
    })
    if (updated) { setItems((prev) => prev.map((i) => (i.id === id ? updated : i))); setEditId(null); showToast('Saved.', 'success') }
  }

  async function toggleActive(item: SupplierItem) {
    const updated = await call('PATCH', { id: item.id, isActive: !item.isActive })
    if (updated) { setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i))); showToast(updated.isActive ? 'Activated.' : 'Deactivated.', 'success') }
  }

  async function remove(item: SupplierItem) {
    if (item.materialCount > 0) { showToast('This supplier has materials attached. Deactivate it instead.', 'error'); return }
    if (!confirm(`Delete supplier "${item.name}"?`)) return
    const res = await fetch(ENDPOINT, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id }) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { showToast(data.error ?? 'Something went wrong.', 'error'); return }
    router.refresh()
    setItems((prev) => prev.filter((i) => i.id !== item.id))
    showToast('Supplier deleted.', 'success')
  }

  return (
    <div className="space-y-4">
      {/* Add row */}
      <div className="grid gap-2 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2">
        <Input label="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Gulf Building Materials" />
        <Input label="Contact name" value={draft.contactName} onChange={(e) => setDraft({ ...draft, contactName: e.target.value })} placeholder="optional" />
        <Input label="Contact phone" value={draft.contactPhone} onChange={(e) => setDraft({ ...draft, contactPhone: e.target.value })} placeholder="optional" />
        <Input label="Contact email" value={draft.contactEmail} onChange={(e) => setDraft({ ...draft, contactEmail: e.target.value })} placeholder="optional" />
        <div className="sm:col-span-2 flex justify-end">
          <Button onClick={add} loading={adding} disabled={!draft.name.trim()}>Add supplier</Button>
        </div>
      </div>

      {/* List */}
      <div className="divide-y divide-border rounded-lg border border-border bg-surface">
        {items.length === 0 && <p className="px-4 py-6 text-center text-sm text-fg-subtle">No suppliers yet.</p>}
        {items.map((item) => (
          <div key={item.id} className="px-4 py-3">
            {editId === item.id ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Name" />
                <Input value={edit.contactName} onChange={(e) => setEdit({ ...edit, contactName: e.target.value })} placeholder="Contact name" />
                <Input value={edit.contactPhone} onChange={(e) => setEdit({ ...edit, contactPhone: e.target.value })} placeholder="Contact phone" />
                <Input value={edit.contactEmail} onChange={(e) => setEdit({ ...edit, contactEmail: e.target.value })} placeholder="Contact email" />
                <div className="sm:col-span-2 flex justify-end gap-2">
                  <Button size="sm" onClick={() => saveEdit(item.id)}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-fg">{item.name}</span>
                  {!item.isActive && <Badge tone="neutral" className="ml-2">inactive</Badge>}
                  {item.materialCount > 0 && <span className="ml-2 text-xs text-fg-subtle">{item.materialCount} material{item.materialCount === 1 ? '' : 's'}</span>}
                  <p className="text-xs text-fg-subtle">
                    {[item.contactName, item.contactPhone, item.contactEmail].filter(Boolean).join(' · ') || 'No contact details'}
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => { setEditId(item.id); setEdit({ name: item.name, contactName: item.contactName ?? '', contactPhone: item.contactPhone ?? '', contactEmail: item.contactEmail ?? '' }) }}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => toggleActive(item)}>{item.isActive ? 'Deactivate' : 'Activate'}</Button>
                <Button size="sm" variant="ghost" onClick={() => remove(item)}>Delete</Button>
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-fg-subtle">
        A supplier with materials attached is deactivated (hidden from new pick-lists), not deleted. Deletion is
        allowed only once no material references it.
      </p>
    </div>
  )
}
