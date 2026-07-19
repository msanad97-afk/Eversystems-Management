export function ProgressBar({ percent, className = '' }: { percent: number; className?: string }) {
  const p = Math.max(0, Math.min(100, percent))
  return (
    <div
      className={`h-2 w-full overflow-hidden rounded-full bg-surface-muted ${className}`}
      role="progressbar"
      aria-valuenow={Math.round(p)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-full rounded-full bg-primary" style={{ width: `${p}%` }} />
    </div>
  )
}
