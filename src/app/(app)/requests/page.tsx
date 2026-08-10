import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/permissions'
import { prisma } from '@/lib/prisma'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { MaterialRequestStatusBadge } from '@/components/materialRequests/MaterialRequestStatusBadge'
import { scopeChain } from '@/components/materialRequests/types'

export const dynamic = 'force-dynamic'

function scopeLabel(r: { asset: { name: string } | null; activity: { name: string } | null }): string {
  return scopeChain(r.asset?.name, r.activity?.name)
}

export default async function RequestsPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  if (user.role !== 'SUPERVISOR') redirect('/')

  const requests = await prisma.materialRequest.findMany({
    where: { requestedById: user.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, requestCode: true, status: true, createdAt: true, submittedAt: true,
      project: { select: { name: true } },
      asset: { select: { name: true } },
      activity: { select: { name: true } },
      _count: { select: { lines: true } },
    },
  })

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-fg">Material requests</h1>
        <Link href="/requests/new"><Button>New request</Button></Link>
      </div>

      {requests.length === 0 ? (
        <EmptyState title="No requests yet" description="Raise a request for the materials you need on site." />
      ) : (
        <div className="space-y-2">
          {requests.map((r) => (
            <Link key={r.id} href={`/requests/${r.id}`} className="block rounded-lg border border-border bg-surface p-4 hover:bg-surface-muted">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="mono text-xs text-fg-subtle">{r.requestCode}</p>
                  <p className="font-medium text-fg">{r.project.name}</p>
                  <p className="text-sm text-fg-muted">{scopeLabel(r)} · {r._count.lines} material{r._count.lines === 1 ? '' : 's'}</p>
                </div>
                <MaterialRequestStatusBadge status={r.status} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
