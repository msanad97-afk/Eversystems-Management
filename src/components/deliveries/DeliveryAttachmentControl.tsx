'use client'

import { useRef, useState } from 'react'
import { useToast } from '@/contexts/ToastContext'

/**
 * Delivery-note attachment control. "View note" opens a short-lived signed URL from the view
 * endpoint (private blob — never a raw src). Upload/replace is shown only to those who may upload
 * (report author or admin); the file input allows camera capture so supervisors can photograph
 * paper notes on site. Quantities/evidence only — no cost anywhere.
 */
export function DeliveryAttachmentControl({
  reportId,
  deliveryId,
  hasAttachment: initialHasAttachment,
  canUpload,
}: {
  reportId: string
  deliveryId: string
  hasAttachment: boolean
  canUpload: boolean
}) {
  const { showToast } = useToast()
  const [hasAttachment, setHasAttachment] = useState(initialHasAttachment)
  const [uploading, setUploading] = useState(false)
  const [opening, setOpening] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const endpoint = `/api/reports/${reportId}/deliveries/${deliveryId}/attachment`

  async function view() {
    setOpening(true)
    try {
      const res = await fetch(endpoint)
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.url) throw new Error(data.error ?? 'Could not open the note.')
      window.open(data.url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not open the note.', 'error')
    } finally {
      setOpening(false)
    }
  }

  async function upload(file: File) {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(endpoint, { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Upload failed.')
      setHasAttachment(true)
      showToast('Delivery note attached.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Upload failed.', 'error')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  if (!hasAttachment && !canUpload) return null

  return (
    <div className="mt-1 flex items-center gap-3">
      {hasAttachment && (
        <button type="button" onClick={view} disabled={opening} className="text-xs font-medium text-primary-700 hover:underline">
          {opening ? 'Opening…' : 'View note'}
        </button>
      )}
      {canUpload && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            capture="environment"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f) }}
          />
          <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading} className="text-xs font-medium text-primary-700 hover:underline disabled:opacity-50">
            {uploading ? 'Uploading…' : hasAttachment ? 'Replace note' : 'Upload note'}
          </button>
        </>
      )}
    </div>
  )
}
