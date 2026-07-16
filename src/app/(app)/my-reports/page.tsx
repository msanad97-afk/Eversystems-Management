import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/permissions'
import { prisma } from '@/lib/prisma'
import { ReportCard, type ReportListItem } from '@/components/reports/ReportCard'
import { activityRollupSelect, rollupActivities } from '@/lib/reports/summary'
import { EmptyState } from '@/components/ui/EmptyState'

export const dynamic = 'force-dynamic'

export default async function MyReportsPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const reports = await prisma.dailyReport.findMany({
    where: { authorId: user.id },
    orderBy: [{ reportDate: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      reportCode: true,
      reportDate: true,
      status: true,
      project: { select: { id: true, projectCode: true, name: true } },
      activities: activityRollupSelect,
    },
  })

  const items: ReportListItem[] = reports.map((r) => ({
    id: r.id,
    reportCode: r.reportCode,
    reportDate: r.reportDate.toISOString().slice(0, 10),
    status: r.status,
    project: r.project,
    ...rollupActivities(r.activities),
  }))

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-fg">My reports</h1>
      {items.length === 0 ? (
        <EmptyState title="No reports yet" description="Reports you create will appear here." />
      ) : (
        <div className="space-y-2">
          {items.map((r) => (
            <ReportCard key={r.id} report={r} />
          ))}
        </div>
      )}
    </div>
  )
}
