import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth/permissions'
import { nextCode } from '@/lib/idgen'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { isNonEmptyString } from '@/lib/validation'
import { getReportScope } from '@/lib/reports/access'
import { buildReportListWhere, type ReportFilters } from '@/lib/reports/query'
import { validateReportDate } from '@/lib/reports/rules'
import { projectHasActiveActivities } from '@/lib/reports/progress'
import { activityRollupSelect, rollupActivities } from '@/lib/reports/summary'
import type { ReportStatus } from '@prisma/client'

function parseStatus(v: string | null): ReportStatus | null {
  const all: ReportStatus[] = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED']
  return v && (all as string[]).includes(v) ? (v as ReportStatus) : null
}

function parseDateParam(v: string | null): Date | null {
  if (!v) return null
  const d = new Date(`${v}T00:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function GET(req: NextRequest) {
  const guard = await requireUser()
  if ('error' in guard) return guard.error

  const scope = await getReportScope(guard.user.id, guard.user.role)
  const sp = req.nextUrl.searchParams
  const filters: ReportFilters = {
    projectId: sp.get('projectId'),
    from: parseDateParam(sp.get('from')),
    to: parseDateParam(sp.get('to')),
    status: parseStatus(sp.get('status')),
    authorId: sp.get('authorId'),
  }

  const where = buildReportListWhere(scope, filters)

  const reports = await prisma.dailyReport.findMany({
    where,
    orderBy: [{ reportDate: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      reportCode: true,
      reportDate: true,
      status: true,
      submittedAt: true,
      updatedAt: true,
      project: { select: { id: true, projectCode: true, name: true } },
      author: { select: { id: true, firstName: true, lastName: true } },
      activities: activityRollupSelect,
    },
  })

  return NextResponse.json({
    reports: reports.map((r) => ({
      id: r.id,
      reportCode: r.reportCode,
      reportDate: r.reportDate.toISOString().slice(0, 10),
      status: r.status,
      submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
      updatedAt: r.updatedAt.toISOString(),
      project: r.project,
      author: { id: r.author.id, name: `${r.author.firstName} ${r.author.lastName}` },
      ...rollupActivities(r.activities),
    })),
  })
}

export async function POST(req: NextRequest) {
  const guard = await requireUser()
  if ('error' in guard) return guard.error

  // VIEWER is read-only.
  if (guard.user.role === 'VIEWER') {
    return NextResponse.json({ error: 'Viewers cannot create reports.' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const projectId = isNonEmptyString(body?.projectId) ? body.projectId : null
  const reportDateStr = isNonEmptyString(body?.reportDate) ? body.reportDate : null
  if (!projectId || !reportDateStr) {
    return NextResponse.json({ error: 'Project and date are required.' }, { status: 400 })
  }

  const reportDate = parseDateParam(reportDateStr)
  if (!reportDate) return NextResponse.json({ error: 'Invalid date.' }, { status: 400 })

  const dateError = validateReportDate(reportDate)
  if (dateError) return NextResponse.json({ error: dateError }, { status: 400 })

  // Author must be a member of the project.
  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: guard.user.id } },
  })
  if (!membership) {
    return NextResponse.json({ error: 'You are not assigned to this project.' }, { status: 403 })
  }

  // Mandatory setup: a project with no active activities cannot receive reports.
  if (!(await projectHasActiveActivities(projectId))) {
    return NextResponse.json(
      { error: 'This project has no activities set up yet. Contact your administrator.' },
      { status: 400 },
    )
  }

  // One report per project + date + author: return the existing one instead of duplicating.
  const existing = await prisma.dailyReport.findUnique({
    where: {
      projectId_reportDate_authorId: { projectId, reportDate, authorId: guard.user.id },
    },
    select: { id: true },
  })
  if (existing) {
    return NextResponse.json({ error: 'A report already exists for this date.', existingId: existing.id }, { status: 409 })
  }

  const year = reportDate.getUTCFullYear()
  const created = await prisma.$transaction(async (tx) => {
    const reportCode = await nextCode(tx, `report:${year}`, `DR-${year}`, 4)
    return tx.dailyReport.create({
      data: {
        reportCode,
        projectId,
        authorId: guard.user.id,
        reportDate,
        status: 'DRAFT',
      },
      select: { id: true, reportCode: true },
    })
  })

  writeAuditLog({
    action: 'REPORT_CREATED',
    userId: guard.user.id,
    projectId,
    entity: 'DailyReport',
    entityId: created.id,
    entityCode: created.reportCode,
    metadata: { reportDate: reportDateStr },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ report: created }, { status: 201 })
}
