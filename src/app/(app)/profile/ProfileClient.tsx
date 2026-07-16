'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import type { Role } from '@prisma/client'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { useToast } from '@/contexts/ToastContext'

interface ProfileData {
  userCode: string
  email: string
  firstName: string
  lastName: string
  phone: string
  role: Role
  mustChangePassword: boolean
}

const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Administrator',
  SUPERVISOR: 'Supervisor',
  VIEWER: 'Viewer',
}

export function ProfileClient({ user }: { user: ProfileData }) {
  const { showToast } = useToast()
  const { update } = useSession()
  const router = useRouter()

  const [firstName, setFirstName] = useState(user.firstName)
  const [lastName, setLastName] = useState(user.lastName)
  const [phone, setPhone] = useState(user.phone)
  const [savingProfile, setSavingProfile] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault()
    setSavingProfile(true)
    try {
      const res = await fetch('/api/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, phone }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Could not save profile.')
      }
      showToast('Profile saved.', 'success')
      router.refresh()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save profile.', 'error')
    } finally {
      setSavingProfile(false)
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    setPasswordError(null)
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.')
      return
    }
    setSavingPassword(true)
    try {
      const res = await fetch('/api/users/me/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'Could not change password.')
      }
      showToast('Password changed.', 'success')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      if (user.mustChangePassword) {
        await update({ mustChangePassword: false })
        router.push('/')
        router.refresh()
      }
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Could not change password.')
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-fg">Your profile</h1>
        <p className="mono mt-1 text-sm text-fg-subtle">
          {user.userCode} · {ROLE_LABEL[user.role]}
        </p>
      </div>

      {user.mustChangePassword && (
        <div className="rounded-lg border border-warning bg-warning-bg px-4 py-3">
          <p className="text-sm font-medium text-warning">
            Set your own password to continue. You&apos;re using a temporary password created by
            your administrator.
          </p>
        </div>
      )}

      {/* Account details */}
      <form onSubmit={saveProfile} className="space-y-4 rounded-lg border border-border bg-surface p-5">
        <h2 className="text-base font-semibold text-fg">Account details</h2>
        <Input label="Email" value={user.email} disabled hint="Contact an administrator to change your email." />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
          <Input label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
        </div>
        <Input
          label="Phone"
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <div className="flex justify-end">
          <Button type="submit" loading={savingProfile} disabled={user.mustChangePassword}>
            Save changes
          </Button>
        </div>
      </form>

      {/* Change password */}
      <form
        onSubmit={changePassword}
        className="space-y-4 rounded-lg border border-border bg-surface p-5"
      >
        <h2 className="text-base font-semibold text-fg">Change password</h2>
        <Input
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
        />
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          hint="At least 8 characters, with a letter and a number."
          required
        />
        <Input
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          error={passwordError ?? undefined}
          required
        />
        <div className="flex items-center justify-between">
          {user.mustChangePassword ? (
            <Badge tone="warning">Required</Badge>
          ) : (
            <span />
          )}
          <Button type="submit" loading={savingPassword}>
            Update password
          </Button>
        </div>
      </form>
    </div>
  )
}
