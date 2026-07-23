import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth/permissions'
import { loadExecutiveDashboard } from '@/lib/executive.server'

const utcDay = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) }

/** The whole executive dashboard in one payload (one round trip). ADMIN-only. */
export async function GET(req: NextRequest) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const months = Math.min(Math.max(Number(req.nextUrl.searchParams.get('months')) || 6, 1), 24)
  return NextResponse.json(await loadExecutiveDashboard(months, utcDay()))
}
