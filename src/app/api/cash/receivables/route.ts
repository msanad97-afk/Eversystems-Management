import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/permissions'
import { loadReceivables } from '@/lib/cash.server'

const utcDay = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) }

/** Company-wide receivables, one row per period at the current certified revision. ADMIN-only. */
export async function GET() {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error
  return NextResponse.json({ receivables: await loadReceivables({ today: utcDay() }) })
}
