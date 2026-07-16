'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BOTTOM_NAV_ITEMS, itemsForRole } from '@/components/layout/nav'

/** Mobile bottom navigation for SUPERVISOR only. */
export function BottomNav() {
  const pathname = usePathname()
  const items = itemsForRole(BOTTOM_NAV_ITEMS, 'SUPERVISOR')

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface pb-safe md:hidden">
      {items.map((item) => {
        const active = pathname === item.href
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2.5 text-xs font-medium ${
              active ? 'text-primary' : 'text-fg-subtle'
            }`}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
