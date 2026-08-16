'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/contexts/ToastContext'

/**
 * Delivery-note attachment control. "View note" is a plain anchor to the GET endpoint, which
 * 302-redirects to a short-lived signed URL (private blob — never a raw src). Using an anchor
 * (no fetch, no post-await window.open) is what makes it open on iOS Safari. Upload/replace is
 * shown only to those who may upload (report author or admin); the file input allows camera
 * capture so supervisors can photograph paper notes on site. Evidence only — no cost anywhere.
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
  const router = useRouter()
  const { showToast } = useToast()
  const [hasAttachment, setHasAttachment] = useState(initialHasAttachment)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const endpoint = `/api/reports/${reportId}/deliveries/${deliveryId}/attachment`

  async function upload(file: File) {
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(endpoint, { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Upload failed.')
      setHasAttachment(true) // instant update for this control's own buttons
      router.refresh() // re-sync the parent's delivery data so the "no attachment" label clears
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
        <a
          href={endpoint}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-primary-700 hover:underline"
        >
          View note
        </a>
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
