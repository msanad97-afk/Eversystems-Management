import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { nextCode } from '@/lib/idgen'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { isNonEmptyString } from '@/lib/validation'
import { projectHasActiveActivities } from '@/lib/reports/progress'
import { openingReportDateError } from '@/lib/reports/opening'
import { resolveOpeningReportDate } from '@/lib/reports/opening.server'

export const dynamic = 'force-dynamic'

/**
 * Create the opening-balance report for a project (ADMIN only — a supervisor never files one). It is
 * a normal DailyReport flagged isOpeningBalance, authored by the admin, created as DRAFT to be
 * edited/submitted/approved through the ordinary report routes. One per project. Dated the day before
 * the earliest recorded report by default (so it sits behind the history), or at an admin-supplied
 * date validated against its bounds.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const project = await prisma.project.findUnique({
    where: { id: params.id },
    select: { id: true, projectCode: true, startDate: true },
  })
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })

  const dateError = openingReportDateError(project.startDate)
  if (dateError) return NextResponse.json({ error: dateError }, { status: 400 })

  // Nothing to seed if the project has no scope yet.
  if (!(await projectHasActiveActivities(project.id))) {
    return NextResponse.json({ error: 'This project has no activities set up yet — add scope before the opening balance.' }, { status: 400 })
  }

  // One opening report per project. A second is rejected outright.
  const existingOpening = await prisma.dailyReport.findFirst({
    where: { projectId: project.id, isOpeningBalance: true },
    select: { id: true, status: true },
  })
  if (existingOpening) {
    return NextResponse.json({ error: 'This project already has an opening-balance report.', existingId: existingOpening.id }, { status: 409 })
  }

  const body = await req.json().catch(() => null)
  const suppliedDateStr = isNonEmptyString(body?.reportDate) ? body.reportDate.trim() : null
  const resolved = await resolveOpeningReportDate({ projectId: project.id, startDate: project.startDate!, authorId: guard.user.id, suppliedDateStr })
  if (!resolved.ok) return NextResponse.json({ error: resolved.error }, { status: resolved.status })

  const reportDate = resolved.date // @db.Date UTC-midnight civil
  const year = reportDate.getUTCFullYear()

  let created: { id: string; reportCode: string }
  try {
    created = await prisma.$transaction(async (tx) => {
      const reportCode = await nextCode(tx, `report:${year}`, `DR-${year}`, 4)
      return tx.dailyReport.create({
        data: { reportCode, projectId: project.id, authorId: guard.user.id, reportDate, status: 'DRAFT', isOpeningBalance: true },
        select: { id: true, reportCode: true },
      })
    })
  } catch {
    // Unique backstop for a race between the collision check and the insert.
    return NextResponse.json({ error: `A report already exists on ${reportDate.toISOString().slice(0, 10)} for this author — choose a different date.` }, { status: 409 })
  }

  writeAuditLog({
    action: 'OPENING_REPORT_CREATED',
    userId: guard.user.id,
    projectId: project.id,
    entity: 'DailyReport',
    entityId: created.id,
    entityCode: created.reportCode,
    metadata: { reportDate: reportDate.toISOString().slice(0, 10) },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ report: created }, { status: 201 })
}
