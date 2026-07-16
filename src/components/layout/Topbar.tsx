'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { signOut } from 'next-auth/react'
import { Logo } from '@/components/ui/Logo'
import type { SessionUser } from '@/types/next-auth'

const ROLE_LABEL: Record<SessionUser['role'], string> = {
  ADMIN: 'Administrator',
  SUPERVISOR: 'Supervisor',
  VIEWER: 'Viewer',
}

export function Topbar({ user }: { user: SessionUser }) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const initials = `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase()

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-surface px-4">
      <Link href="/" className="flex items-center" aria-label="Eversystems Management home">
        <Logo size={30} withWordmark />
      </Link>

      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-fg-inverted">
            {initials}
          </span>
          <span className="hidden text-sm font-medium text-fg sm:block">{user.firstName}</span>
        </button>

        {open && (
          <div
            role="menu"
            className="absolute right-0 mt-2 w-56 overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
          >
            <div className="border-b border-border px-4 py-3">
              <p className="text-sm font-semibold text-fg">
                {user.firstName} {user.lastName}
              </p>
              <p className="text-xs text-fg-subtle">{user.email}</p>
              <p className="mono mt-1 text-xs text-fg-subtle">
                {user.userCode} · {ROLE_LABEL[user.role]}
              </p>
            </div>
            <Link
              href="/profile"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-4 py-2.5 text-sm text-fg hover:bg-surface-muted"
            >
              Profile
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="block w-full px-4 py-2.5 text-left text-sm text-danger hover:bg-surface-muted"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
