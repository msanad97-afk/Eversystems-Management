import { NextResponse, type NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { snapshotReportCosts } from '@/lib/reports/costSnapshot'

/**
 * Backfill Actual Cost for reports approved BEFORE the cost snapshot existed (Phase 6B).
 *
 * These are costed at TODAY'S rates, not the rates in force when the work was approved, so
 * every affected report is stamped `costBackfilledAt` and any cost derived from it is
 * labelled an APPROXIMATION wherever it appears. Never automatic; always audited.
 * Reports that already carry approval-time costs are skipped (the snapshotter is write-once).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const project = await prisma.project.findUnique({ where: { id: params.id }, select: { id: true, projectCode: true } })
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })

  // Approved reports that still have at least one un-costed entry.
  const candidates = await prisma.dailyReport.findMany({
    where: {
      projectId: project.id,
      status: 'APPROVED',
      activities: {
        some: {
          subActivities: {
            some: {
              OR: [
                { manpower: { some: { costAtApproval: null } } },
                { materials: { some: { costAtApproval: null } } },
              ],
            },
          },
        },
      },
    },
    select: { id: true, reportCode: true },
  })

  // A report only counts as "backfilled" if it actually GAINED cost. A report whose only
  // gap is an unpriceable resource (no rate anywhere) gains nothing, must not be stamped as
  // an approximation, and must not inflate the count — it stays in the unpriced warning.
  const details: { reportCode: string; cost: number }[] = []
  const stillUnpricedReports: { reportCode: string; entries: number }[] = []
  let totalCost = 0
  let totalUnpriced = 0

  await prisma.$transaction(async (tx) => {
    for (const r of candidates) {
      const res = await snapshotReportCosts(tx, r.id)
      const priced = res.pricedManpower + res.pricedMaterial
      const unpriced = res.unpricedManpower + res.unpricedMaterial
      if (priced > 0) {
        await tx.dailyReport.update({ where: { id: r.id }, data: { costBackfilledAt: new Date() } })
        details.push({ reportCode: r.reportCode, cost: res.totalCost })
        totalCost = Math.round((totalCost + res.totalCost) * 1000) / 1000
      }
      if (unpriced > 0) {
        stillUnpricedReports.push({ reportCode: r.reportCode, entries: unpriced })
        totalUnpriced += unpriced
      }
    }
  })

  writeAuditLog({
    action: 'REPORT_COST_BACKFILLED',
    userId: guard.user.id,
    projectId: project.id,
    entity: 'Project',
    entityId: project.id,
    entityCode: project.projectCode,
    metadata: {
      reportsBackfilled: details.length,
      totalCost,
      unpricedEntries: totalUnpriced,
      basis: 'today_rates_approximation',
      details,
      stillUnpricedReports,
    } as unknown as Prisma.InputJsonValue,
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({
    ok: true,
    reportsBackfilled: details.length,
    totalCost,
    unpricedEntries: totalUnpriced,
    details,
    stillUnpricedReports,
  })
}
