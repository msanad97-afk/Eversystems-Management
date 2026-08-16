import { describe, it, expect } from 'vitest'
import { SIDEBAR_ITEMS, itemsForRole } from '@/components/layout/nav'

// The mobile drawer renders itemsForRole(SIDEBAR_ITEMS, role) — the SAME source the desktop
// sidebar uses. These assert the shared filtered list (not the DOM), so the two can't drift.

describe('mobile nav item source + role filtering', () => {
  it('the drawer items come from the shared SIDEBAR_ITEMS source', () => {
    const supervisorItems = itemsForRole(SIDEBAR_ITEMS, 'SUPERVISOR')
    // Every rendered item is a member of the single shared list (a subset, not a duplicate).
    for (const item of supervisorItems) expect(SIDEBAR_ITEMS).toContain(item)
    expect(supervisorItems.length).toBeGreaterThan(0)
  })

  it('a supervisor sees no management items (nothing under /admin)', () => {
    const supervisorItems = itemsForRole(SIDEBAR_ITEMS, 'SUPERVISOR')
    expect(supervisorItems.every((i) => !i.href.startsWith('/admin'))).toBe(true)
    expect(supervisorItems.every((i) => i.roles.includes('SUPERVISOR'))).toBe(true)
    // Sanity: a management-only destination is present in the source but filtered out for supervisors.
    expect(SIDEBAR_ITEMS.some((i) => i.href === '/admin/users')).toBe(true)
    expect(supervisorItems.some((i) => i.href === '/admin/users')).toBe(false)
  })

  it('an admin sees management items via the same filter', () => {
    const adminItems = itemsForRole(SIDEBAR_ITEMS, 'ADMIN')
    expect(adminItems.some((i) => i.href.startsWith('/admin'))).toBe(true)
    // The two Material Requests destinations never cross roles.
    expect(itemsForRole(SIDEBAR_ITEMS, 'SUPERVISOR').some((i) => i.href === '/admin/requests')).toBe(false)
    expect(adminItems.some((i) => i.href === '/requests')).toBe(false)
  })
})
