import { type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth/permissions'
import { loadWeeklySummary } from '@/lib/weeklySummary.server'
import { renderWeeklySummaryPdf } from '@/lib/pdf/render'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * On-demand generation of THIS week's summary — the SAME document the Sunday cron sends, but
 * downloaded, never emailed, so an admin can check it without waiting for Sunday. ADMIN-only: this
 * document carries money, so a supervisor is refused (403).
 */
export async function GET(_req: NextRequest) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const data = await loadWeeklySummary({})
  const pdf = await renderWeeklySummaryPdf(data)
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="weekly-summary-${data.week.startStr}.pdf"`,
    },
  })
}
