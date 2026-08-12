import type { Role } from '@prisma/client'

export interface NavItem {
  label: string
  href: string
  roles: Role[]
}

/**
 * Sidebar items, shown from the `md` breakpoint up. Only entries whose pages
 * actually exist are listed here — nothing broken is ever clickable.
 *
 * Supervisors are included too. Their bottom nav is `md:hidden`, so without a
 * sidebar entry they had no navigation at all on a desktop viewport and the
 * pages below were reachable only by typing the URL.
 *
 * `roles` is what keeps the two Material Requests destinations apart: the
 * supervisor's own list (/requests) and the admin review queue
 * (/admin/requests) never appear to the other role.
 */
export const SIDEBAR_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/admin', roles: ['ADMIN'] },
  { label: 'Executive', href: '/admin/executive', roles: ['ADMIN'] },
  { label: 'Review', href: '/admin/review', roles: ['ADMIN'] },
  { label: 'Material Requests', href: '/admin/requests', roles: ['ADMIN'] },
  { label: 'Inventory Alerts', href: '/admin/alerts', roles: ['ADMIN'] },
  { label: 'Reports', href: '/admin/reports', roles: ['ADMIN', 'VIEWER'] },
  { label: 'Users', href: '/admin/users', roles: ['ADMIN'] },
  { label: 'Projects', href: '/admin/projects', roles: ['ADMIN'] },
  { label: 'Cash', href: '/admin/cash', roles: ['ADMIN'] },
  { label: 'Catalogs', href: '/admin/catalogs', roles: ['ADMIN'] },
  { label: 'Home', href: '/', roles: ['SUPERVISOR'] },
  { label: 'My Reports', href: '/my-reports', roles: ['SUPERVISOR'] },
  { label: 'Material Requests', href: '/requests', roles: ['SUPERVISOR'] },
]

/**
 * Supervisor bottom-nav items (mobile only): Home · My Reports · Requests
 * (spec 4.10). Labels stay short here because the bar splits the viewport width
 * evenly between them; the sidebar uses the full "Material Requests" wording.
 */
export const BOTTOM_NAV_ITEMS: NavItem[] = [
  { label: 'Home', href: '/', roles: ['SUPERVISOR'] },
  { label: 'My Reports', href: '/my-reports', roles: ['SUPERVISOR'] },
  { label: 'Requests', href: '/requests', roles: ['SUPERVISOR'] },
]

export function itemsForRole(items: NavItem[], role: Role): NavItem[] {
  return items.filter((i) => i.roles.includes(role))
}
