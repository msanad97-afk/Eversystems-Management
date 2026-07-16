'use client'

import { useRouter } from 'next/navigation'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'

interface Filters {
  projectId: string
  from: string
  to: string
}

export function DashboardFilters({
  projects,
  filters,
}: {
  projects: { id: string; name: string; projectCode: string }[]
  filters: Filters
}) {
  const router = useRouter()

  function setFilter(patch: Partial<Filters>) {
    const next = { ...filters, ...patch }
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(next)) if (v) params.set(k, v)
    router.push(`/admin${params.toString() ? `?${params}` : ''}`)
  }

  return (
    <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-3">
      <Select label="Project" value={filters.projectId} onChange={(e) => setFilter({ projectId: e.target.value })}>
        <option value="">All active projects</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </Select>
      <Input label="From" type="date" value={filters.from} onChange={(e) => setFilter({ from: e.target.value })} />
      <Input label="To" type="date" value={filters.to} onChange={(e) => setFilter({ to: e.target.value })} />
    </div>
  )
}
