import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth/permissions'
import { loadProjectBudget } from '@/lib/budget.server'

/**
 * Phase 6A: ADMIN-only. This payload carries lumpsum BHD, so it is a financial view —
 * VIEWER keeps the physical-progress and dashboard views only.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const budget = await loadProjectBudget(params.id)
  if (!budget) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
  return NextResponse.json({ budget })
}
