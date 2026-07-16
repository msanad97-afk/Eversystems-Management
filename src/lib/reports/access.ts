import type { Role } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { ReportScope } from '@/lib/reports/query'

/** Builds the role-scoping context for report access from the current user. */
export async function getReportScope(userId: string, role: Role): Promise<ReportScope> {
  const memberships = await prisma.projectMember.findMany({
    where: { userId },
    select: { projectId: true },
  })
  return { role, userId, memberProjectIds: memberships.map((m) => m.projectId) }
}
