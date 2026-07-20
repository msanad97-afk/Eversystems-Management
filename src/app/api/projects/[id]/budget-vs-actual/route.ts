import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth/permissions'
import { loadBudgetVsActual } from '@/lib/actuals.server'

/**
 * Phase 6A: ADMIN-only. This payload carries lumpsum budget/earned BHD, so it is a
 * financial view — VIEWER keeps the physical-progress and dashboard views only.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const data = await loadBudgetVsActual(params.id)
  if (!data) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
  return NextResponse.json({ budgetVsActual: data })
}
