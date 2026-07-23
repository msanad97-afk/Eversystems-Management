import type { Role } from '@prisma/client'

export interface NavItem {
  label: string
  href: string
  roles: Role[]
}

/**
 * Sidebar items shown to ADMIN / VIEWER. Only entries whose pages actually exist in
 * the current phase are listed here (Phase 1: Users + Projects). Later phases add
 * Review · Reports · Dashboard · Catalogs. Nothing broken is ever clickable.
 */
export const SIDEBAR_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/admin', roles: ['ADMIN'] },
  { label: 'Review', href: '/admin/review', roles: ['ADMIN'] },
  { label: 'Reports', href: '/admin/reports', roles: ['ADMIN', 'VIEWER'] },
  { label: 'Users', href: '/admin/users', roles: ['ADMIN'] },
  { label: 'Projects', href: '/admin/projects', roles: ['ADMIN'] },
  { label: 'Cash', href: '/admin/cash', roles: ['ADMIN'] },
  { label: 'Catalogs', href: '/admin/catalogs', roles: ['ADMIN'] },
]

/** Supervisor bottom-nav items (mobile): Home · My Reports (spec 4.10). */
export const BOTTOM_NAV_ITEMS: NavItem[] = [
  { label: 'Home', href: '/', roles: ['SUPERVISOR'] },
  { label: 'My Reports', href: '/my-reports', roles: ['SUPERVISOR'] },
]

export function itemsForRole(items: NavItem[], role: Role): NavItem[] {
  return items.filter((i) => i.roles.includes(role))
}
