'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Role, UserStatus } from '@prisma/client'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { useToast } from '@/contexts/ToastContext'
import { UserForm, type ProjectOption, type UserFormPayload } from '@/components/admin/UserForm'

interface AdminUser {
  id: string
  userCode: string
  firstName: string
  lastName: string
  email: string
  phone: string
  role: Role
  status: UserStatus
  lastLoginAt: string | null
  projects: ProjectOption[]
}

const ROLE_TONE: Record<Role, 'primary' | 'info' | 'neutral'> = {
  ADMIN: 'primary',
  SUPERVISOR: 'info',
  VIEWER: 'neutral',
}

export function UsersClient({ users, projects }: { users: AdminUser[]; projects: ProjectOption[] }) {
  const router = useRouter()
  const { showToast } = useToast()

  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<AdminUser | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null)

  async function createUser(payload: UserFormPayload) {
    setSubmitting(true)
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not create user.')
      setCreateOpen(false)
      if (data.tempPassword) {
        setCredentials({ email: data.user.email, password: data.tempPassword })
      }
      showToast('User created.', 'success')
      router.refresh()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not create user.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  async function updateUser(payload: UserFormPayload) {
    if (!editing) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/users/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not update user.')
      const editedEmail = editing.email
      setEditing(null)
      if (data.tempPassword) {
        setCredentials({ email: editedEmail, password: data.tempPassword })
      }
      showToast('User updated.', 'success')
      router.refresh()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update user.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleStatus(user: AdminUser) {
    const nextStatus: UserStatus = user.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not change status.')
      showToast(nextStatus === 'ACTIVE' ? 'User reactivated.' : 'User deactivated.', 'success')
      router.refresh()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not change status.', 'error')
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-fg">Users</h1>
          <p className="text-sm text-fg-subtle">{users.length} total</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>Create user</Button>
      </div>

      {users.length === 0 ? (
        <EmptyState title="No users yet" description="Create your first user to get started." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Code</TH>
              <TH>Name</TH>
              <TH>Email</TH>
              <TH>Role</TH>
              <TH>Status</TH>
              <TH>Projects</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {users.map((u) => (
              <TR key={u.id}>
                <TD className="mono whitespace-nowrap text-xs text-fg-muted">{u.userCode}</TD>
                <TD className="whitespace-nowrap font-medium">
                  {u.firstName} {u.lastName}
                </TD>
                <TD className="whitespace-nowrap text-fg-muted">{u.email}</TD>
                <TD>
                  <Badge tone={ROLE_TONE[u.role]}>{u.role.toLowerCase()}</Badge>
                </TD>
                <TD>
                  <Badge tone={u.status === 'ACTIVE' ? 'success' : 'neutral'}>
                    {u.status.toLowerCase()}
                  </Badge>
                </TD>
                <TD className="text-fg-muted">{u.projects.length}</TD>
                <TD>
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => toggleStatus(u)}>
                      {u.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                    </Button>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {/* Create modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create user">
        <UserForm
          mode="create"
          projects={projects}
          submitting={submitting}
          onSubmit={createUser}
          onCancel={() => setCreateOpen(false)}
        />
      </Modal>

      {/* Edit modal */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Edit ${editing?.firstName ?? ''}`}>
        {editing && (
          <UserForm
            mode="edit"
            projects={projects}
            submitting={submitting}
            initial={{
              firstName: editing.firstName,
              lastName: editing.lastName,
              email: editing.email,
              phone: editing.phone,
              role: editing.role,
              status: editing.status,
              projectIds: editing.projects.map((p) => p.id),
            }}
            onSubmit={updateUser}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>

      {/* Credentials (shown once) */}
      <CredentialsModal
        credentials={credentials}
        onClose={() => setCredentials(null)}
        onCopied={() => showToast('Copied to clipboard.', 'success')}
      />
    </div>
  )
}

function CredentialsModal({
  credentials,
  onClose,
  onCopied,
}: {
  credentials: { email: string; password: string } | null
  onClose: () => void
  onCopied: () => void
}) {
  async function copy() {
    if (!credentials) return
    try {
      await navigator.clipboard.writeText(
        `Email: ${credentials.email}\nTemporary password: ${credentials.password}`,
      )
      onCopied()
    } catch {
      /* clipboard unavailable — user can copy manually */
    }
  }

  return (
    <Modal
      open={!!credentials}
      onClose={onClose}
      title="Temporary password"
      footer={
        <>
          <Button variant="secondary" onClick={copy}>
            Copy
          </Button>
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      {credentials && (
        <div className="space-y-3">
          <p className="text-sm text-fg-muted">
            Share these with the user. They&apos;ll be asked to set their own password on first
            sign-in. This password won&apos;t be shown again.
          </p>
          <div className="space-y-1 rounded-md bg-surface-subtle p-3 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-fg-subtle">Email</span>
              <span className="font-medium text-fg">{credentials.email}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-fg-subtle">Password</span>
              <span className="mono font-medium text-fg">{credentials.password}</span>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
