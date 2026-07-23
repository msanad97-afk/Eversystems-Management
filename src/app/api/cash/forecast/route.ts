import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth/permissions'
import { loadForecast } from '@/lib/cash.server'

const utcDay = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) }

/**
 * Monthly projected INFLOW plus the cleared balance. Deliberately has NO outflow field —
 * expenses have no due date, so an outflow line would be invented (§6E.5). The UI states this.
 * ADMIN-only.
 */
export async function GET(req: NextRequest) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const months = Math.min(Math.max(Number(req.nextUrl.searchParams.get('months')) || 6, 1), 24)
  return NextResponse.json(await loadForecast(months, utcDay()))
}
