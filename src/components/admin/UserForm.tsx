'use client'

import { useState } from 'react'
import type { Role, UserStatus } from '@prisma/client'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { generateTempPassword } from '@/lib/auth/tempPassword'

export interface ProjectOption {
  id: string
  projectCode: string
  name: string
}

export interface UserFormInitial {
  firstName: string
  lastName: string
  email: string
  phone: string
  role: Role
  status: UserStatus
  projectIds: string[]
}

export interface UserFormPayload {
  firstName: string
  lastName: string
  email?: string
  phone: string
  role: Role
  status?: UserStatus
  projectIds: string[]
  tempPassword?: string
  resetPassword?: boolean
}

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'SUPERVISOR', label: 'Supervisor — submits & edits reports' },
  { value: 'VIEWER', label: 'Viewer — read-only' },
  { value: 'ADMIN', label: 'Administrator — full access' },
]

export function UserForm({
  mode,
  initial,
  projects,
  submitting,
  onSubmit,
  onCancel,
}: {
  mode: 'create' | 'edit'
  initial?: UserFormInitial
  projects: ProjectOption[]
  submitting: boolean
  onSubmit: (payload: UserFormPayload) => void
  onCancel: () => void
}) {
  const [firstName, setFirstName] = useState(initial?.firstName ?? '')
  const [lastName, setLastName] = useState(initial?.lastName ?? '')
  const [email, setEmail] = useState(initial?.email ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [role, setRole] = useState<Role>(initial?.role ?? 'SUPERVISOR')
  const [status, setStatus] = useState<UserStatus>(initial?.status ?? 'ACTIVE')
  const [projectIds, setProjectIds] = useState<string[]>(initial?.projectIds ?? [])

  // Create: optional temp password (blank = auto-generate). Edit: opt-in reset.
  const [tempPassword, setTempPassword] = useState('')
  const [resetPassword, setResetPassword] = useState(false)

  function toggleProject(id: string) {
    setProjectIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const payload: UserFormPayload = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone: phone.trim(),
      role,
      projectIds,
    }
    if (mode === 'create') {
      payload.email = email.trim()
      if (tempPassword.trim()) payload.tempPassword = tempPassword.trim()
    } else {
      payload.status = status
      if (resetPassword) {
        payload.resetPassword = true
        if (tempPassword.trim()) payload.tempPassword = tempPassword.trim()
      }
    }
    onSubmit(payload)
  }

  return (
    <form id="user-form" onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
        <Input label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
      </div>

      {mode === 'create' ? (
        <Input
          label="Email"
          type="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      ) : (
        <Input label="Email" value={email} disabled hint="Email cannot be changed." />
      )}

      <Input label="Phone (optional)" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />

      <Select label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
        {ROLE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>

      {mode === 'edit' && (
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as UserStatus)}>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive — cannot sign in</option>
        </Select>
      )}

      {/* Project assignments */}
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-fg">Assigned projects</span>
        {projects.length === 0 ? (
          <p className="text-sm text-fg-subtle">No projects yet. Create a project first.</p>
        ) : (
          <div className="max-h-44 overflow-y-auto rounded-md border border-border-strong">
            {projects.map((p) => (
              <label
                key={p.id}
                className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0 hover:bg-surface-subtle"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={projectIds.includes(p.id)}
                  onChange={() => toggleProject(p.id)}
                />
                <span className="text-sm text-fg">{p.name}</span>
                <span className="mono ml-auto text-xs text-fg-subtle">{p.projectCode}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Temp password */}
      {mode === 'create' ? (
        <div className="rounded-md bg-surface-subtle p-3">
          <div className="flex items-end gap-2">
            <Input
              label="Temporary password"
              value={tempPassword}
              onChange={(e) => setTempPassword(e.target.value)}
              hint="Leave blank to auto-generate. The user must change it on first login."
              placeholder="Auto-generate"
            />
            <Button type="button" variant="secondary" onClick={() => setTempPassword(generateTempPassword())}>
              Generate
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-md bg-surface-subtle p-3">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={resetPassword}
              onChange={(e) => setResetPassword(e.target.checked)}
            />
            <span className="text-sm font-medium text-fg">Reset this user&apos;s password</span>
          </label>
          {resetPassword && (
            <div className="mt-3 flex items-end gap-2">
              <Input
                label="New temporary password"
                value={tempPassword}
                onChange={(e) => setTempPassword(e.target.value)}
                hint="Leave blank to auto-generate."
                placeholder="Auto-generate"
              />
              <Button type="button" variant="secondary" onClick={() => setTempPassword(generateTempPassword())}>
                Generate
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" loading={submitting}>
          {mode === 'create' ? 'Create user' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}
