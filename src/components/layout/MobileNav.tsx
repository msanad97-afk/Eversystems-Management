'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { Role } from '@prisma/client'
import { SIDEBAR_ITEMS, itemsForRole } from '@/components/layout/nav'

/**
 * Mobile navigation: a hamburger in the header (shown only below the `md` sidebar breakpoint)
 * that opens the SAME nav as the desktop sidebar in a slide-in drawer. Items come from the shared
 * `SIDEBAR_ITEMS` via `itemsForRole`, so role filtering matches the sidebar exactly and the two
 * lists can never drift. Desktop is untouched (the button is `md:hidden`; the sidebar stays).
 */
export function MobileNav({ role }: { role: Role }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const wasOpen = useRef(false)

  const items = itemsForRole(SIDEBAR_ITEMS, role)

  // Close when the route changes (e.g. after an item is tapped).
  useEffect(() => { setOpen(false) }, [pathname])

  // While open: lock body scroll, trap focus, close on Escape.
  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusables = () => (panel ? Array.from(panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')) : [])
    focusables()[0]?.focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return }
      if (e.key !== 'Tab') return
      const f = focusables()
      if (f.length === 0) return
      const first = f[0]!
      const last = f[f.length - 1]!
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  // Return focus to the hamburger when the drawer closes.
  useEffect(() => {
    if (wasOpen.current && !open) buttonRef.current?.focus()
    wasOpen.current = open
  }, [open])

  const isActive = (href: string) => pathname === href || (href !== '/admin' && pathname.startsWith(`${href}/`))

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-11 w-11 items-center justify-center rounded-md text-fg hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary md:hidden"
        aria-label="Open navigation menu"
        aria-expanded={open}
        aria-controls="mobile-nav-drawer"
      >
        <svg width={22} height={22} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div ref={panelRef} id="mobile-nav-drawer" className="absolute inset-y-0 left-0 flex w-64 max-w-[80%] flex-col bg-surface shadow-xl">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
                {role === 'SUPERVISOR' ? 'Menu' : 'Management'}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation menu"
                className="inline-flex h-11 w-11 items-center justify-center rounded-md text-fg-subtle hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                ✕
              </button>
            </div>
            <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
              {items.length === 0 ? (
                <p className="px-3 py-2 text-sm text-fg-subtle">Sections appear here as features are added.</p>
              ) : (
                items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={`flex min-h-[44px] items-center rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      isActive(item.href) ? 'bg-primary-50 text-primary-700' : 'text-fg-muted hover:bg-surface-muted'
                    }`}
                  >
                    {item.label}
                  </Link>
                ))
              )}
            </nav>
          </div>
        </div>
      )}
    </>
  )
}
