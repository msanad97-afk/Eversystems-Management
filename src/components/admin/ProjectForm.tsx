'use client'

import { useState } from 'react'
import type { ProjectStatus } from '@prisma/client'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'

export interface UserOption {
  id: string
  userCode: string
  firstName: string
  lastName: string
  role: string
}

export interface ProjectFormInitial {
  name: string
  location: string
  status: ProjectStatus
  startDate: string // YYYY-MM-DD or ''
  memberIds: string[]
}

export interface ProjectFormPayload {
  name: string
  location: string
  status: ProjectStatus
  startDate: string | null
  memberIds: string[]
}

export function ProjectForm({
  mode,
  initial,
  users,
  submitting,
  onSubmit,
  onCancel,
}: {
  mode: 'create' | 'edit'
  initial?: ProjectFormInitial
  users: UserOption[]
  submitting: boolean
  onSubmit: (payload: ProjectFormPayload) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [location, setLocation] = useState(initial?.location ?? '')
  const [status, setStatus] = useState<ProjectStatus>(initial?.status ?? 'ACTIVE')
  const [startDate, setStartDate] = useState(initial?.startDate ?? '')
  const [memberIds, setMemberIds] = useState<string[]>(initial?.memberIds ?? [])

  function toggleMember(id: string) {
    setMemberIds((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    onSubmit({
      name: name.trim(),
      location: location.trim(),
      status,
      startDate: startDate.trim() === '' ? null : startDate,
      memberIds,
    })
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Input label="Project name" value={name} onChange={(e) => setName(e.target.value)} required />
      <Input label="Location (optional)" value={location} onChange={(e) => setLocation(e.target.value)} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
          <option value="ACTIVE">Active</option>
          <option value="ON_HOLD">On hold</option>
          <option value="COMPLETED">Completed</option>
        </Select>
        <Input
          label="Start date (optional)"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-fg">Assigned members</span>
        {users.length === 0 ? (
          <p className="text-sm text-fg-subtle">No users yet. Create a user first.</p>
        ) : (
          <div className="max-h-44 overflow-y-auto rounded-md border border-border-strong">
            {users.map((u) => (
              <label
                key={u.id}
                className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0 hover:bg-surface-subtle"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={memberIds.includes(u.id)}
                  onChange={() => toggleMember(u.id)}
                />
                <span className="text-sm text-fg">
                  {u.firstName} {u.lastName}
                </span>
                <span className="mono ml-auto text-xs text-fg-subtle">{u.userCode}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" loading={submitting}>
          {mode === 'create' ? 'Create project' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}
