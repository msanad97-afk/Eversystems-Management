import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth/permissions'
import { loadOpenAlerts } from '@/lib/deliveries/alertsView.server'

/**
 * OPEN inventory alerts for management. ADMIN ONLY — the permission check here (not just the UI)
 * keeps supervisors out. Quantities only; no cost is loaded.
 */
export async function GET(_req: NextRequest) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  return NextResponse.json({ alerts: await loadOpenAlerts() })
}
