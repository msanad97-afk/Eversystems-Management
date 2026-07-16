import type { Prisma, ReportStatus, Role } from '@prisma/client'

export interface ReportFilters {
  projectId?: string | null
  from?: Date | null
  to?: Date | null
  status?: ReportStatus | null
  authorId?: string | null
}

export interface ReportScope {
  role: Role
  userId: string
  /** Project ids the user is a member of (used to scope VIEWER access). */
  memberProjectIds: string[]
}

/**
 * Builds the Prisma `where` for listing reports, enforcing role scoping:
 *   - SUPERVISOR: only their own reports (authorId = self)
 *   - VIEWER:     reports on projects they are a member of (read-only)
 *   - ADMIN:      all reports
 * Then applies the optional filters. The authorId filter is ignored for SUPERVISOR
 * (they are already locked to their own reports).
 */
export function buildReportListWhere(
  scope: ReportScope,
  filters: ReportFilters = {},
): Prisma.DailyReportWhereInput {
  const where: Prisma.DailyReportWhereInput = {}

  if (scope.role === 'SUPERVISOR') {
    where.authorId = scope.userId
  } else if (scope.role === 'VIEWER') {
    where.projectId = { in: scope.memberProjectIds }
  }
  // ADMIN: no base scoping.

  if (filters.projectId) {
    // Intersect with VIEWER's allowed set if already constrained.
    if (scope.role === 'VIEWER') {
      where.projectId = scope.memberProjectIds.includes(filters.projectId)
        ? filters.projectId
        : '__none__'
    } else {
      where.projectId = filters.projectId
    }
  }

  if (filters.status) where.status = filters.status

  if (filters.authorId && scope.role !== 'SUPERVISOR') {
    where.authorId = filters.authorId
  }

  if (filters.from || filters.to) {
    where.reportDate = {}
    if (filters.from) where.reportDate.gte = filters.from
    if (filters.to) where.reportDate.lte = filters.to
  }

  return where
}

/**
 * Whether a user may READ a specific report given its author and project.
 *   - ADMIN: always
 *   - SUPERVISOR: only if they authored it
 *   - VIEWER: only if a member of the report's project
 */
export function canReadReport(
  scope: ReportScope,
  report: { authorId: string; projectId: string },
): boolean {
  switch (scope.role) {
    case 'ADMIN':
      return true
    case 'SUPERVISOR':
      return report.authorId === scope.userId
    case 'VIEWER':
      return scope.memberProjectIds.includes(report.projectId)
    default:
      return false
  }
}

/** Whether a user may MUTATE (edit/submit/recall) a report — author only. */
export function canAuthorReport(scope: ReportScope, report: { authorId: string }): boolean {
  return report.authorId === scope.userId
}
