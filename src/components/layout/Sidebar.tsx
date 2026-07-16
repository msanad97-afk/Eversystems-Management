'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { Role } from '@prisma/client'
import { SIDEBAR_ITEMS, itemsForRole } from '@/components/layout/nav'

export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname()
  const items = itemsForRole(SIDEBAR_ITEMS, role)

  return (
    <aside className="hidden w-56 shrink-0 border-r border-border bg-surface md:block">
      <nav className="flex flex-col gap-1 p-3">
        <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
          Management
        </p>
        {items.length === 0 ? (
          <p className="px-3 py-2 text-sm text-fg-subtle">
            Sections appear here as features are added.
          </p>
        ) : (
          items.map((item) => {
            // '/admin' (Dashboard) matches only exactly, so it isn't active on deeper /admin/* pages.
            const active =
              pathname === item.href || (item.href !== '/admin' && pathname.startsWith(`${item.href}/`))
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  active ? 'bg-primary-50 text-primary-700' : 'text-fg-muted hover:bg-surface-muted'
                }`}
              >
                {item.label}
              </Link>
            )
          })
        )}
      </nav>
    </aside>
  )
}
