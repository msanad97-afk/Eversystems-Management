import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/permissions'
import { loadCashPosition } from '@/lib/cash.server'

/** Per-account and company cleared + projected balances. ADMIN-only. */
export async function GET() {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error
  return NextResponse.json(await loadCashPosition())
}
