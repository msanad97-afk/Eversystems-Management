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
