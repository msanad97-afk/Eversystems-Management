type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'primary'

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-muted text-fg-muted',
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-danger',
  info: 'bg-info-bg text-info',
  primary: 'bg-primary-50 text-primary-700',
}

export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: React.ReactNode
  tone?: Tone
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  )
}
