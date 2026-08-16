'use client'

import { useRouter } from 'next/navigation'
import { Select } from '@/components/ui/Select'

/** Project filter for the inventory page. Mirrors the dashboard filter; defaults to all active projects. */
export function InventoryFilters({
  projects,
  projectId,
}: {
  projects: { id: string; name: string; projectCode: string }[]
  projectId: string
}) {
  const router = useRouter()

  function setProject(next: string) {
    const params = new URLSearchParams()
    if (next) params.set('projectId', next)
    router.push(`/admin/inventory${params.toString() ? `?${params}` : ''}`)
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4 sm:max-w-sm">
      <Select label="Project" value={projectId} onChange={(e) => setProject(e.target.value)}>
        <option value="">All active projects</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </Select>
    </div>
  )
}
