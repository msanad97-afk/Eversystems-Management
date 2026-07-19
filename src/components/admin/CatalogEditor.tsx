'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { useToast } from '@/contexts/ToastContext'

export interface CatalogItem {
  id: string
  name: string
  unit?: string
  isActive: boolean
  sortOrder: number
}

type Kind = 'labor' | 'material'

const ENDPOINT: Record<Kind, string> = {
  labor: '/api/catalogs/labor',
  material: '/api/catalogs/materials',
}
const RESP_KEY: Record<Kind, string> = { labor: 'category', material: 'material' }

export function CatalogEditor({ kind, initial }: { kind: Kind; initial: CatalogItem[] }) {
  const router = useRouter()
  const { showToast } = useToast()
  const [items, setItems] = useState<CatalogItem[]>(initial)
  const [name, setName] = useState('')
  const [unit, setUnit] = useState('')
  const [adding, setAdding] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editUnit, setEditUnit] = useState('')

  const isMaterial = kind === 'material'
  const noun = isMaterial ? 'Material' : 'Category'

  async function call(method: 'POST' | 'PATCH', body: unknown): Promise<CatalogItem | null> {
    const res = await fetch(ENDPOINT[kind], {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      showToast(data.error ?? 'Something went wrong.', 'error')
      return null
    }
    // Keep the server (and any tab remount) in sync with the DB.
    router.refresh()
    return data[RESP_KEY[kind]] as CatalogItem
  }

  async function add() {
    if (!name.trim() || (isMaterial && !unit.trim())) return
    setAdding(true)
    const created = await call('POST', { name: name.trim(), unit: unit.trim() })
    if (created) {
      setItems((prev) => [...prev, created])
      setName('')
      setUnit('')
      showToast('Added.', 'success')
    }
    setAdding(false)
  }

  async function saveEdit(id: string) {
    const updated = await call('PATCH', { id, name: editName.trim(), unit: editUnit.trim() })
    if (updated) {
      setItems((prev) => prev.map((i) => (i.id === id ? updated : i)))
      setEditId(null)
      showToast('Saved.', 'success')
    }
  }

  async function toggleActive(item: CatalogItem) {
    const updated = await call('PATCH', { id: item.id, isActive: !item.isActive })
    if (updated) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)))
      showToast(updated.isActive ? 'Activated.' : 'Deactivated.', 'success')
    }
  }

  async function remove(item: CatalogItem) {
    if (!confirm(`Remove "${item.name}"? If it's in use anywhere it will be deactivated instead of deleted.`)) return
    const res = await fetch(ENDPOINT[kind], {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      showToast(data.error ?? 'Something went wrong.', 'error')
      return
    }
    router.refresh()
    if (data.deleted) {
      setItems((prev) => prev.filter((i) => i.id !== item.id))
      showToast(`${noun} deleted.`, 'success')
    } else if (data.deactivated) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, isActive: false } : i)))
      showToast('In use — deactivated instead of deleted (history preserved).', 'info')
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const target = index + dir
    if (target < 0 || target >= items.length) return
    const a = items[index]!
    const b = items[target]!
    // Swap sort orders.
    const [ua, ub] = await Promise.all([
      call('PATCH', { id: a.id, sortOrder: b.sortOrder }),
      call('PATCH', { id: b.id, sortOrder: a.sortOrder }),
    ])
    if (ua && ub) {
      setItems((prev) => {
        const next = [...prev]
        next[index] = ub
        next[target] = ua
        return next.sort((x, y) => x.sortOrder - y.sortOrder)
      })
    }
  }

  return (
    <div className="space-y-4">
      {/* Add row */}
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface p-4">
        <div className="min-w-[45%] flex-1">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder={isMaterial ? 'e.g. OPC Cement' : 'e.g. Mason'} />
        </div>
        {isMaterial && (
          <div className="w-28">
            <Input label="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="bag" />
          </div>
        )}
        <Button onClick={add} loading={adding} disabled={!name.trim() || (isMaterial && !unit.trim())}>
          Add
        </Button>
      </div>

      {/* List */}
      <div className="divide-y divide-border rounded-lg border border-border bg-surface">
        {items.length === 0 && <p className="px-4 py-6 text-center text-sm text-fg-subtle">No entries yet.</p>}
        {items.map((item, index) => (
          <div key={item.id} className="flex items-center gap-2 px-4 py-3">
            <div className="flex flex-col">
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                className="text-fg-subtle disabled:opacity-30"
                aria-label="Move up"
              >
                ▲
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === items.length - 1}
                className="text-fg-subtle disabled:opacity-30"
                aria-label="Move down"
              >
                ▼
              </button>
            </div>

            {editId === item.id ? (
              <div className="flex flex-1 flex-wrap items-end gap-2">
                <div className="min-w-[40%] flex-1">
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                </div>
                {isMaterial && (
                  <div className="w-24">
                    <Input value={editUnit} onChange={(e) => setEditUnit(e.target.value)} />
                  </div>
                )}
                <Button size="sm" onClick={() => saveEdit(item.id)}>Save</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>Cancel</Button>
              </div>
            ) : (
              <>
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-fg">{item.name}</span>
                  {isMaterial && <span className="ml-2 text-sm text-fg-subtle">{item.unit}</span>}
                  {!item.isActive && (
                    <Badge tone="neutral" className="ml-2">inactive</Badge>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditId(item.id)
                    setEditName(item.name)
                    setEditUnit(item.unit ?? '')
                  }}
                >
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => toggleActive(item)}>
                  {item.isActive ? 'Deactivate' : 'Activate'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(item)}>Delete</Button>
              </>
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-fg-subtle">
        Delete removes an unused entry outright; anything referenced by a report or a catalog budget is
        deactivated instead — hidden from new pick-lists but kept on all existing history.
      </p>
    </div>
  )
}
