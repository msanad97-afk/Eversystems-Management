import type { Prisma, ReportStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { civilMidnightUtc } from '@/lib/datetime'
import { defaultOpeningDate, validateOpeningDate } from '@/lib/reports/opening'

/**
 * DB-backed resolution of the opening-report date, shared by the create route (no self yet) and the
 * draft PATCH (excludes the opening report itself). Computes the default when none is supplied,
 * validates a supplied date against its bounds, and turns a same-author date collision (the
 * (projectId, reportDate, authorId) unique key) into a readable 409 rather than a raw Prisma error.
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/

export type OpeningDateResult = { ok: true; date: Date } | { ok: false; status: number; error: string }

/** Earliest recorded report date for the project, optionally excluding one report (the opening one). */
export async function earliestReportDate(projectId: string, excludeReportId?: string): Promise<Date | null> {
  const row = await prisma.dailyReport.findFirst({
    where: { projectId, ...(excludeReportId ? { id: { not: excludeReportId } } : {}) },
    orderBy: { reportDate: 'asc' },
    select: { reportDate: true },
  })
  return row?.reportDate ?? null
}

export async function resolveOpeningReportDate(opts: {
  projectId: string
  startDate: Date
  authorId: string
  suppliedDateStr?: string | null
  excludeReportId?: string
}): Promise<OpeningDateResult> {
  const earliest = await earliestReportDate(opts.projectId, opts.excludeReportId)

  let date: Date
  if (opts.suppliedDateStr) {
    if (!ISO.test(opts.suppliedDateStr)) return { ok: false, status: 400, error: 'Invalid date.' }
    date = civilMidnightUtc(opts.suppliedDateStr)
    if (Number.isNaN(date.getTime())) return { ok: false, status: 400, error: 'Invalid date.' }
  } else {
    date = defaultOpeningDate(opts.startDate, earliest)
  }

  // Collision BEFORE the bounds: a same-author report at this date is always the project's earliest
  // report, so a bare bounds check would report it as "on/after earliest". A duplicate should read as
  // a duplicate — a readable 409 — not a raw Prisma unique error and not the wrong message.
  const clash = await prisma.dailyReport.findFirst({
    where: { projectId: opts.projectId, reportDate: date, authorId: opts.authorId, ...(opts.excludeReportId ? { id: { not: opts.excludeReportId } } : {}) },
    select: { id: true },
  })
  if (clash) {
    return { ok: false, status: 409, error: `A report already exists on ${date.toISOString().slice(0, 10)} for this author — choose a different date.` }
  }

  // Bounds apply to a SUPPLIED date only; a computed default is trusted.
  if (opts.suppliedDateStr) {
    const err = validateOpeningDate(date, opts.startDate, earliest)
    if (err) return { ok: false, status: 400, error: err }
  }

  return { ok: true, date }
}

// ─── Re-open (a NARROW, gated exception to approved-report immutability) ──────────

export interface ReopenCandidate {
  id: string
  isOpeningBalance: boolean
  status: ReportStatus
  projectId: string
  reportDate: Date
}

/**
 * The gate for re-opening an opening-balance report. Every failure is a 409 with a reason an admin
 * can act on. Order matters: the isOpeningBalance check comes FIRST so a normal report can never be
 * re-opened here. It then refuses anything that would falsify figures already committed against these
 * numbers — a CERTIFIED valuation (a certificate was issued against them; any certified one blocks,
 * not narrowed by date) or an APPROVED report dated after the opening balance (later work was
 * recorded on top of it). (Considered and deliberately NOT in the gate: sent emails are historical
 * documents, not live figures; cash receipts commit only against CERTIFIED valuations, already
 * covered; EVM/baseline recompute live. If a committed dependency is added later, extend this gate.)
 */
export async function openingReopenGate(r: ReopenCandidate): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!r.isOpeningBalance) {
    return { ok: false, reason: 'This is not an opening-balance report. A normal approved report can never be re-opened here — corrections flow forward as a new report.' }
  }
  if (r.status !== 'APPROVED') {
    return { ok: false, reason: `This opening report is ${r.status.toLowerCase()}, not approved — there is nothing to re-open.` }
  }
  const certified = await prisma.valuation.count({ where: { projectId: r.projectId, status: 'CERTIFIED' } })
  if (certified > 0) {
    return { ok: false, reason: 'A valuation has been certified on this project. Re-opening would change figures that certificate was issued against. Correct forward with a new report instead.' }
  }
  const later = await prisma.dailyReport.findFirst({
    where: { projectId: r.projectId, status: 'APPROVED', id: { not: r.id }, reportDate: { gt: r.reportDate } },
    orderBy: { reportDate: 'asc' },
    select: { reportCode: true, reportDate: true },
  })
  if (later) {
    return { ok: false, reason: `A later report (${later.reportCode}, ${later.reportDate.toISOString().slice(0, 10)}) has been approved against these figures. Re-opening the opening balance would invalidate work recorded after it. Correct forward with a new report instead.` }
  }
  return { ok: true }
}

/**
 * Undo the approval- and submit-time snapshots on an opening report so re-approving re-derives them
 * cleanly instead of double-counting or leaving stale figures. Runs inside the re-open transaction.
 *
 *  - costAtApproval / rateAtApproval on the report's manpower + material entries → cleared, so
 *    snapshotReportCosts re-prices on re-approval (a stale snapshot would corrupt AC).
 *  - ConsumptionEntry (derived AND COUNT_ADJUSTMENT) for the report → deleted, because
 *    recordConsumptionOnSubmit / reconcileStockCountsOnSubmit are idempotent-by-existence and would
 *    otherwise skip re-derivation and keep the old, pre-edit quantities.
 *  - MISSING_CONSUMPTION_RATE alerts sourced from the report's sub-activity rows → deleted, since a
 *    draft edit replaces those rows (orphaning the alerts); re-submit re-raises any still applicable.
 */
export async function resetOpeningReportSnapshots(tx: Prisma.TransactionClient, reportId: string): Promise<void> {
  const subReports = await tx.reportSubActivity.findMany({ where: { reportActivity: { reportId } }, select: { id: true } })
  const subIds = subReports.map((s) => s.id)
  if (subIds.length > 0) {
    await tx.manpowerEntry.updateMany({ where: { reportSubActivityId: { in: subIds } }, data: { rateAtApproval: null, costAtApproval: null } })
    await tx.materialEntry.updateMany({ where: { reportSubActivityId: { in: subIds } }, data: { rateAtApproval: null, costAtApproval: null } })
    await tx.inventoryAlert.deleteMany({ where: { type: 'MISSING_CONSUMPTION_RATE', sourceRecordId: { in: subIds } } })
  }
  await tx.consumptionEntry.deleteMany({ where: { dailyReportId: reportId } })
}
