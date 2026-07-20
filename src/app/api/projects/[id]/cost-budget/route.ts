import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth/permissions'
import { loadProjectMoney } from '@/lib/money.server'

/** Cost budget (BAC), contract value and margin. ADMIN-only — financial views are admin-only. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const money = await loadProjectMoney(params.id)
  if (!money) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
  return NextResponse.json({ money })
}
