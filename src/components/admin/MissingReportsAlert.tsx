export function MissingReportsAlert({
  missing,
}: {
  missing: { projectCode: string; name: string }[]
}) {
  if (missing.length === 0) {
    return (
      <div className="rounded-lg border border-success bg-success-bg px-4 py-3 text-sm text-success">
        All active projects have a report for yesterday.
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-warning bg-warning-bg px-4 py-3">
      <p className="text-sm font-semibold text-warning">
        {missing.length} active project{missing.length > 1 ? 's' : ''} missing a report for yesterday
      </p>
      <ul className="mt-1 space-y-0.5">
        {missing.map((p) => (
          <li key={p.projectCode} className="text-sm text-fg">
            {p.name} <span className="mono text-xs text-fg-subtle">{p.projectCode}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
