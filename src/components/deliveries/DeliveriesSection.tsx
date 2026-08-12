'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/contexts/ToastContext'
import type { MaterialOption } from '@/components/reports/formTypes'
import { newKey } from '@/components/reports/formTypes'
import type { DeliveryView } from '@/lib/deliveries/types'

interface LineDraft {
  key: string
  materialId: string
  quantity: string
}

/**
 * Deliveries editor on the daily report (supervisor). QUANTITIES ONLY — supplier, note number,
 * material lines (material + quantity + unit), optional notes. Attachment is added in 2B; a
 * delivery saved without one raises a MISSING_ATTACHMENT alert on submit. No cost anywhere.
 */
export function DeliveriesSection({
  reportId,
  initialDeliveries,
  materials,
}: {
  reportId: string
  initialDeliveries: DeliveryView[]
  materials: MaterialOption[]
}) {
  const { showToast } = useToast()
  const [deliveries, setDeliveries] = useState<DeliveryView[]>(initialDeliveries)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)

  const [supplierName, setSupplierName] = useState('')
  const [deliveryNoteNumber, setDeliveryNoteNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([{ key: newKey(), materialId: '', quantity: '' }])

  function resetForm() {
    setSupplierName(''); setDeliveryNoteNumber(''); setNotes('')
    setLines([{ key: newKey(), materialId: '', quantity: '' }])
    setAdding(false)
  }

  async function save() {
    const payloadLines = lines.filter((l) => l.materialId && Number(l.quantity) > 0).map((l) => ({ materialId: l.materialId, quantity: Number(l.quantity) }))
    if (!supplierName.trim() || !deliveryNoteNumber.trim()) { showToast('Supplier and delivery note number are required.', 'error'); return }
    if (payloadLines.length === 0) { showToast('Add at least one material with a quantity.', 'error'); return }
    setBusy(true)
    try {
      const res = await fetch(`/api/reports/${reportId}/deliveries`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplierName: supplierName.trim(), deliveryNoteNumber: deliveryNoteNumber.trim(), notes: notes.trim() || null, lines: payloadLines }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not save delivery.')
      setDeliveries((prev) => [...prev, data.delivery as DeliveryView])
      showToast('Delivery added.', 'success')
      resetForm()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save delivery.', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    setBusy(true)
    try {
      const res = await fetch(`/api/reports/${reportId}/deliveries/${id}`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not remove delivery.')
      setDeliveries((prev) => prev.filter((d) => d.id !== id))
      showToast('Delivery removed.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not remove delivery.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Deliveries</h2>
        {!adding && <Button type="button" variant="secondary" size="sm" onClick={() => setAdding(true)}>+ Add delivery</Button>}
      </div>

      {deliveries.map((d) => (
        <div key={d.id} className="rounded-lg border border-border bg-surface p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium text-fg">{d.supplierName}</p>
              <p className="text-xs text-fg-subtle">Note {d.deliveryNoteNumber}{d.hasAttachment ? ' · attachment' : ' · no attachment'}</p>
            </div>
            <button type="button" onClick={() => remove(d.id)} disabled={busy} className="text-fg-subtle hover:text-danger" aria-label="Remove delivery">✕</button>
          </div>
          <ul className="mt-2 space-y-0.5 border-t border-border pt-2">
            {d.lines.map((l) => (
              <li key={l.id} className="flex justify-between text-sm text-fg">
                <span>{l.materialName}</span>
                <span className="tabular-nums text-fg-muted">{l.quantity} {l.unit}</span>
              </li>
            ))}
          </ul>
          {d.notes && <p className="mt-1 text-xs text-fg-muted">{d.notes}</p>}
        </div>
      ))}

      {deliveries.length === 0 && !adding && <p className="text-sm text-fg-subtle">No deliveries recorded.</p>}

      {adding && (
        <div className="rounded-lg border border-border bg-surface p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-fg">Supplier *</span>
              <input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-fg" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-fg">Delivery note no. *</span>
              <input value={deliveryNoteNumber} onChange={(e) => setDeliveryNoteNumber(e.target.value)} className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-fg" />
            </label>
          </div>
          <div className="mt-2 space-y-1">
            {lines.map((l, i) => {
              const mat = materials.find((m) => m.id === l.materialId)
              return (
                <div key={l.key} className="flex items-center gap-2">
                  <select value={l.materialId} onChange={(e) => setLines((prev) => prev.map((x, j) => (j === i ? { ...x, materialId: e.target.value } : x)))} className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-fg">
                    <option value="">Material…</option>
                    {materials.map((m) => (<option key={m.id} value={m.id}>{m.name}{m.isActive ? '' : ' (inactive)'}</option>))}
                  </select>
                  <input type="number" inputMode="decimal" min={0} step="any" placeholder="Qty" value={l.quantity} onChange={(e) => setLines((prev) => prev.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} className="w-20 rounded-md border border-border bg-surface px-2 py-1.5 text-sm tabular-nums text-fg" />
                  <span className="w-10 text-xs text-fg-subtle">{mat?.unit ?? ''}</span>
                  <button type="button" onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))} className="text-fg-subtle hover:text-danger" aria-label="Remove line">✕</button>
                </div>
              )
            })}
            <button type="button" onClick={() => setLines((prev) => [...prev, { key: newKey(), materialId: '', quantity: '' }])} className="text-xs font-medium text-primary-700 hover:underline">+ Add material</button>
          </div>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notes (optional)" className="mt-2 w-full resize-y rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-fg placeholder:text-fg-subtle" />
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={resetForm} disabled={busy}>Cancel</Button>
            <Button type="button" size="sm" onClick={save} loading={busy}>Save delivery</Button>
          </div>
        </div>
      )}
    </div>
  )
}
