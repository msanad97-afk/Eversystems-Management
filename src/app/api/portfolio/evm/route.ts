import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth/permissions'
import { loadPortfolioEvm } from '@/lib/evm.server'

/**
 * Company EVM roll-up over ACTIVE projects only, value-weighted (ΣEV/ΣPV, ΣEV/ΣAC).
 * Read-only building block for the executive dashboard phase. ADMIN-only.
 */
export async function GET(req: NextRequest) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const asOfRaw = req.nextUrl.searchParams.get('asOf')
  let asOf: Date | undefined
  if (asOfRaw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfRaw)) return NextResponse.json({ error: 'asOf must be YYYY-MM-DD.' }, { status: 400 })
    const d = new Date(`${asOfRaw}T00:00:00.000Z`)
    if (Number.isNaN(d.getTime())) return NextResponse.json({ error: 'asOf is not a valid date.' }, { status: 400 })
    asOf = d
  }

  return NextResponse.json({ portfolio: await loadPortfolioEvm(asOf) })
}
