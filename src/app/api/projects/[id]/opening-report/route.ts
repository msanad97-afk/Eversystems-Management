import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { nextCode } from '@/lib/idgen'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { projectHasActiveActivities } from '@/lib/reports/progress'
import { openingReportDateError } from '@/lib/reports/opening'

export const dynamic = 'force-dynamic'

/**
 * Create the opening-balance report for a project (ADMIN only — a supervisor never files one). It is
 * a normal DailyReport flagged isOpeningBalance, authored by the admin and dated at Project.startDate,
 * created as DRAFT to be edited/submitted/approved through the ordinary report routes. One per project.
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

  const reportDate = project.startDate! // non-null (guarded above); stored as @db.Date
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
    // Unique backstop: the admin already authored a report on the start date for this project.
    return NextResponse.json({ error: 'A report already exists for the project start date. It may already be the opening balance.' }, { status: 409 })
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
