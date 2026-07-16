import { prisma } from '@/lib/prisma'
import { requireAdminPage } from '@/lib/auth/permissions'
import { activityRollupSelect, rollupActivities } from '@/lib/reports/summary'
import { ReviewClient, type ReviewItem } from './ReviewClient'

export const dynamic = 'force-dynamic'

export default async function AdminReviewPage() {
  await requireAdminPage()

  // Reports that have entered review (submitted at least once); drafts are excluded.
  const reports = await prisma.dailyReport.findMany({
    where: { status: { in: ['SUBMITTED', 'APPROVED', 'REJECTED'] } },
    orderBy: [{ submittedAt: 'desc' }, { reportDate: 'desc' }],
    select: {
      id: true,
      reportCode: true,
      reportDate: true,
      status: true,
      submittedAt: true,
      project: { select: { name: true, projectCode: true } },
      author: { select: { firstName: true, lastName: true } },
      activities: activityRollupSelect,
    },
  })

  const items: ReviewItem[] = reports.map((r) => ({
    id: r.id,
    reportCode: r.reportCode,
    reportDate: r.reportDate.toISOString().slice(0, 10),
    status: r.status,
    submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
    projectName: r.project.name,
    projectCode: r.project.projectCode,
    author: `${r.author.firstName} ${r.author.lastName}`,
    ...rollupActivities(r.activities),
  }))

  return <ReviewClient items={items} />
}
