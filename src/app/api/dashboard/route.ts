import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth/permissions'
import { loadDashboard } from '@/lib/dashboard.server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const sp = req.nextUrl.searchParams
  const result = await loadDashboard({
    projectId: sp.get('projectId') || undefined,
    from: sp.get('from'),
    to: sp.get('to'),
  })

  return NextResponse.json(result)
}
