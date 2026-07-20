import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth/permissions'
import { loadProjectCostPerformance } from '@/lib/cost.server'

/** Actual Cost + cost performance vs the 6A budget. ADMIN-only. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const cost = await loadProjectCostPerformance(params.id)
  if (!cost) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
  return NextResponse.json({ cost })
}
