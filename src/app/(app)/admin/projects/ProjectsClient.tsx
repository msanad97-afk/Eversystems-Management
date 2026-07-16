'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ProjectStatus } from '@prisma/client'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { useToast } from '@/contexts/ToastContext'
import { ProjectForm, type UserOption, type ProjectFormPayload } from '@/components/admin/ProjectForm'

interface AdminProject {
  id: string
  projectCode: string
  name: string
  location: string
  status: ProjectStatus
  startDate: string
  members: UserOption[]
  hasScope: boolean
}

const STATUS_TONE: Record<ProjectStatus, 'success' | 'warning' | 'neutral'> = {
  ACTIVE: 'success',
  ON_HOLD: 'warning',
  COMPLETED: 'neutral',
}

const STATUS_LABEL: Record<ProjectStatus, string> = {
  ACTIVE: 'Active',
  ON_HOLD: 'On hold',
  COMPLETED: 'Completed',
}

export function ProjectsClient({
  projects,
  users,
}: {
  projects: AdminProject[]
  users: UserOption[]
}) {
  const router = useRouter()
  const { showToast } = useToast()

  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<AdminProject | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function createProject(payload: ProjectFormPayload) {
    setSubmitting(true)
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not create project.')
      setCreateOpen(false)
      showToast('Project created.', 'success')
      router.refresh()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not create project.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  async function updateProject(payload: ProjectFormPayload) {
    if (!editing) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/projects/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not update project.')
      setEditing(null)
      showToast('Project updated.', 'success')
      router.refresh()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update project.', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-fg">Projects</h1>
          <p className="text-sm text-fg-subtle">{projects.length} total</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>Create project</Button>
      </div>

      {projects.length === 0 ? (
        <EmptyState title="No projects yet" description="Create your first project to get started." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Code</TH>
              <TH>Name</TH>
              <TH>Location</TH>
              <TH>Status</TH>
              <TH>Members</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {projects.map((p) => (
              <TR key={p.id}>
                <TD className="mono whitespace-nowrap text-xs text-fg-muted">{p.projectCode}</TD>
                <TD className="whitespace-nowrap font-medium">
                  <Link href={`/admin/projects/${p.id}`} className="hover:underline">{p.name}</Link>
                  {!p.hasScope && <Badge tone="warning" className="ml-2">no scope</Badge>}
                </TD>
                <TD className="whitespace-nowrap text-fg-muted">{p.location || '—'}</TD>
                <TD>
                  <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge>
                </TD>
                <TD className="text-fg-muted">{p.members.length}</TD>
                <TD>
                  <div className="flex justify-end gap-1">
                    <Link href={`/admin/projects/${p.id}`}>
                      <Button size="sm" variant="ghost">Open</Button>
                    </Link>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>Edit</Button>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create project">
        <ProjectForm
          mode="create"
          users={users}
          submitting={submitting}
          onSubmit={createProject}
          onCancel={() => setCreateOpen(false)}
        />
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Edit ${editing?.name ?? ''}`}>
        {editing && (
          <ProjectForm
            mode="edit"
            users={users}
            submitting={submitting}
            initial={{
              name: editing.name,
              location: editing.location,
              status: editing.status,
              startDate: editing.startDate,
              memberIds: editing.members.map((m) => m.id),
            }}
            onSubmit={updateProject}
            onCancel={() => setEditing(null)}
          />
        )}
      </Modal>
    </div>
  )
}
