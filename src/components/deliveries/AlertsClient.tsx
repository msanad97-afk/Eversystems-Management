'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { useToast } from '@/contexts/ToastContext'
import type { AlertView } from '@/lib/deliveries/alertsView.server'

const TYPE_LABEL: Record<AlertView['type'], string> = {
  MISSING_ATTACHMENT: 'Missing attachment',
  COUNT_VARIANCE: 'Count variance',
  NEGATIVE_BALANCE: 'Negative balance',
  MISSING_CONSUMPTION_RATE: 'Missing consumption rate',
}

export function AlertsClient({ initialAlerts }: { initialAlerts: AlertView[] }) {
  const router = useRouter()
  const { showToast } = useToast()
  const [alerts, setAlerts] = useState<AlertView[]>(initialAlerts)
  const [busy, setBusy] = useState<string | null>(null)

  async function acknowledge(id: string) {
    setBusy(id)
    try {
      const res = await fetch(`/api/inventory-alerts/${id}/acknowledge`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not acknowledge.')
      setAlerts((prev) => prev.filter((a) => a.id !== id))
      showToast('Alert acknowledged.', 'success')
      router.refresh()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not acknowledge.', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-fg">Inventory alerts</h1>
      {alerts.length === 0 ? (
        <EmptyState title="No open alerts" description="Alerts raised on report submit appear here." />
      ) : (
        <div className="space-y-2">
          {alerts.map((a) => (
            <div key={a.id} className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Badge tone="warning">{TYPE_LABEL[a.type]}</Badge>
                  <span className="text-sm font-medium text-fg">{a.projectName}</span>
                </div>
                {a.source && (
                  <p className="mt-1 text-sm text-fg-muted">
                    {a.source.supplierName} · note {a.source.deliveryNoteNumber} ·{' '}
                    <Link href={`/reports/${a.source.reportId}`} className="font-medium text-primary-700 hover:underline">{a.source.reportCode}</Link>
                  </p>
                )}
                {a.work && (
                  <p className="mt-1 text-sm text-fg-muted">
                    {a.work.subActivityName} ·{' '}
                    <Link href={`/reports/${a.work.reportId}`} className="font-medium text-primary-700 hover:underline">{a.work.reportCode}</Link>
                    {' '}· no consumption rate set
                  </p>
                )}
                {a.materialName && <p className="mt-1 text-sm text-fg-muted">{a.materialName}{a.quantity != null ? ` · ${a.quantity}` : ''}</p>}
              </div>
              <Button size="sm" variant="secondary" onClick={() => acknowledge(a.id)} loading={busy === a.id}>Acknowledge</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
