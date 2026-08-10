import Link from 'next/link'
import { requireAdminPage } from '@/lib/auth/permissions'
import { prisma } from '@/lib/prisma'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { MaterialRequestStatusBadge } from '@/components/materialRequests/MaterialRequestStatusBadge'
import { scopeChain } from '@/components/materialRequests/types'

export const dynamic = 'force-dynamic'

function fmtTime(iso: Date | null): string {
  return iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
}
function scopeLabel(r: { asset: { name: string } | null; activity: { name: string } | null }): string {
  return scopeChain(r.asset?.name, r.activity?.name)
}

export default async function AdminRequestsPage() {
  await requireAdminPage()

  const requests = await prisma.materialRequest.findMany({
    where: { status: { not: 'DRAFT' } },
    orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true, requestCode: true, status: true, submittedAt: true,
      project: { select: { name: true } },
      asset: { select: { name: true } },
      activity: { select: { name: true } },
      requestedBy: { select: { firstName: true, lastName: true } },
      _count: { select: { lines: true } },
    },
  })
  const pending = requests.filter((r) => r.status === 'SUBMITTED')
  const history = requests.filter((r) => r.status !== 'SUBMITTED')

  function rows(list: typeof requests) {
    return (
      <Table>
        <THead>
          <TR>
            <TH>Code</TH><TH>Project</TH><TH>Scope</TH><TH>Requested by</TH><TH>Materials</TH><TH>Submitted</TH><TH>Status</TH><TH />
          </TR>
        </THead>
        <TBody>
          {list.map((r) => (
            <TR key={r.id}>
              <TD className="mono whitespace-nowrap text-xs">{r.requestCode}</TD>
              <TD className="whitespace-nowrap">{r.project.name}</TD>
              <TD className="whitespace-nowrap text-fg-muted">{scopeLabel(r)}</TD>
              <TD className="whitespace-nowrap text-fg-muted">{r.requestedBy.firstName} {r.requestedBy.lastName}</TD>
              <TD>{r._count.lines}</TD>
              <TD className="whitespace-nowrap text-fg-muted">{fmtTime(r.submittedAt)}</TD>
              <TD><MaterialRequestStatusBadge status={r.status} /></TD>
              <TD>
                <Link href={`/admin/requests/${r.id}`} className="text-sm font-medium text-primary-700 hover:underline">
                  {r.status === 'SUBMITTED' ? 'Review' : 'Open'}
                </Link>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-fg">Material requests</h1>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Pending review ({pending.length})</h2>
        {pending.length === 0 ? <EmptyState title="Nothing to review" description="Submitted requests will appear here." /> : rows(pending)}
      </section>

      {history.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Reviewed</h2>
          {rows(history)}
        </section>
      )}
    </div>
  )
}
