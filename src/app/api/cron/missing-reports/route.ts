import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { writeAuditLog } from '@/lib/audit'
import { civilDateString, civilMidnightUtc } from '@/lib/datetime'
import { notifyMissingReport } from '@/lib/notify/events.server'
import { resolveSystemSenderId } from '@/lib/notify/recipients.server'

export const dynamic = 'force-dynamic'

/** Fail-closed CRON_SECRET read (mirrors getBlobToken): empty/whitespace counts as unset. */
function getCronSecret(): string | null {
  const s = process.env.CRON_SECRET
  return s && s.trim() !== '' ? s : null
}

/**
 * Daily missing-report sweep (Vercel Cron, 20:00 Asia/Bahrain = 17:00 UTC). Every ACTIVE project
 * must have a report for TODAY (Bahrain civil date). A report in ANY status counts as filed — a
 * draft means the supervisor has started, and chasing him is the office's job, not a mail's. One
 * email per project with none, to the REPORT_MISSING list + that project's supervisors, idempotent
 * per project per date. Protected by a CRON_SECRET bearer; fails closed with 401 if absent/wrong.
 */
export async function GET(req: NextRequest) {
  const secret = getCronSecret()
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  const today = civilDateString() // Bahrain civil date, e.g. 2026-09-01
  const todayUtc = civilMidnightUtc(today)

  const [activeProjects, reported, sentById] = await Promise.all([
    prisma.project.findMany({ where: { status: 'ACTIVE' }, orderBy: { projectCode: 'asc' }, select: { id: true, projectCode: true, name: true } }),
    // ANY status counts as filed — no status filter.
    prisma.dailyReport.findMany({ where: { reportDate: todayUtc }, select: { projectId: true }, distinct: ['projectId'] }),
    resolveSystemSenderId(),
  ])
  const reportedSet = new Set(reported.map((r) => r.projectId))
  const missing = activeProjects.filter((p) => !reportedSet.has(p.id))

  if (!sentById) {
    return NextResponse.json({ ok: true, date: today, missing: missing.length, sent: 0, note: 'no active user to attribute automated sends to' })
  }

  const tally = { sent: 0, skipped: 0, noRecipients: 0, failed: 0 }
  for (const p of missing) {
    const outcome = await notifyMissingReport(p, today, sentById)
    if (outcome === 'sent') tally.sent++
    else if (outcome === 'skipped-duplicate') tally.skipped++
    else if (outcome === 'no-recipients') tally.noRecipients++
    else tally.failed++
  }

  writeAuditLog({
    action: 'NOTIFICATION_SENT', userId: sentById,
    entity: 'Cron', entityId: 'missing-reports',
    metadata: { date: today, activeProjects: activeProjects.length, missing: missing.length, ...tally },
  })

  return NextResponse.json({ ok: true, date: today, missing: missing.length, ...tally })
}
