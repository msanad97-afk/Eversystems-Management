'use client'

export type ToastType = 'success' | 'error' | 'info'

export interface ToastItem {
  id: string
  message: string
  type: ToastType
}

const STYLES: Record<ToastType, string> = {
  success: 'bg-success text-fg-inverted',
  error: 'bg-danger text-fg-inverted',
  info: 'bg-neutral-800 text-fg-inverted',
}

export function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onDismiss(item.id)}
      className={`pointer-events-auto w-full rounded-md px-4 py-3 text-left text-sm font-medium shadow-lg ${STYLES[item.type]}`}
      role="status"
    >
      {item.message}
    </button>
  )
}
