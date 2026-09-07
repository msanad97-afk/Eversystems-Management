import { NextResponse, type NextRequest } from 'next/server'
import { resolveSystemSenderId } from '@/lib/notify/recipients.server'
import { deliverWeeklySummary } from '@/lib/notify/weeklySummary.server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Fail-closed CRON_SECRET read (mirrors the missing-reports cron): empty/whitespace counts as unset. */
function getCronSecret(): string | null {
  const s = process.env.CRON_SECRET
  return s && s.trim() !== '' ? s : null
}

/**
 * Weekly management summary (Vercel Cron, Sunday 08:00 Asia/Bahrain = 05:00 UTC). Renders the
 * portfolio + per-project PDF for the week that ENDED the previous day (Sunday→Saturday) and mails it
 * to the WEEKLY_SUMMARY list via the recorded-send path. Idempotent per week; an empty list sends
 * nothing (recorded in the audit). Protected by a CRON_SECRET bearer; fails closed with 401.
 */
export async function GET(req: NextRequest) {
  const secret = getCronSecret()
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  const sentById = await resolveSystemSenderId()
  if (!sentById) {
    return NextResponse.json({ ok: true, sent: 0, note: 'no active user to attribute automated sends to' })
  }

  const { outcome, week } = await deliverWeeklySummary({ sentById })
  return NextResponse.json({ ok: true, week, outcome })
}
