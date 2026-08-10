import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/permissions'
import { prisma } from '@/lib/prisma'
import { loadScopeSignals } from '@/lib/materialRequests/signals.server'
import { fmtQty, scopeChain } from '@/components/materialRequests/types'
import { MaterialRequestStatusBadge } from '@/components/materialRequests/MaterialRequestStatusBadge'
import { RequestActions } from '@/components/materialRequests/RequestActions'

export const dynamic = 'force-dynamic'

export default async function RequestDetailPage({ params }: { params: { id: string } }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const request = await prisma.materialRequest.findUnique({
    where: { id: params.id },
    select: {
      id: true, requestCode: true, status: true, reviewNote: true, projectId: true, assetId: true, activityId: true, requestedById: true,
      project: { select: { name: true } },
      asset: { select: { name: true } },
      activity: { select: { name: true, ref: true } },
      lines: { orderBy: { sortOrder: 'asc' }, select: { id: true, materialId: true, unit: true, requestedQty: true, approvedQty: true, note: true, material: { select: { name: true } } } },
    },
  })
  if (!request) notFound()
  // Supervisor detail is the author's view. Admins review at /admin/requests/[id].
  if (request.requestedById !== user.id) redirect(user.role === 'ADMIN' ? `/admin/requests/${request.id}` : '/')

  const signals = await loadScopeSignals(
    { projectId: request.projectId, assetId: request.assetId, activityId: request.activityId },
    request.id,
  )
  const signalById = new Map(signals.map((s) => [s.materialId, s]))
  const reviewed = request.status !== 'DRAFT' && request.status !== 'SUBMITTED'
  const scope = scopeChain(request.asset?.name, request.activity ? `${request.activity.ref ? `${request.activity.ref} · ` : ''}${request.activity.name}` : null)

  return (
    <div className="space-y-5">
      <div>
        <Link href="/requests" className="text-sm font-medium text-primary-700 hover:underline">← Requests</Link>
        <div className="mt-1 flex items-center justify-between">
          <div>
            <p className="mono text-xs text-fg-subtle">{request.requestCode}</p>
            <h1 className="text-xl font-semibold text-fg">{request.project.name}</h1>
            <p className="text-sm text-fg-muted">{scope}</p>
          </div>
          <MaterialRequestStatusBadge status={request.status} />
        </div>
      </div>

      {/* Reviewed requests print as a quantities-only procurement letter (approved qtys). */}
      {(request.status === 'APPROVED' || request.status === 'PARTIALLY_APPROVED') && (
        <div className="flex justify-end">
          <a href={`/api/material-requests/${request.id}/pdf`} target="_blank" rel="noreferrer" className="text-sm font-medium text-primary-700 hover:underline">
            Download PDF
          </a>
        </div>
      )}

      {request.reviewNote && (
        <div className="rounded-md border border-border bg-surface-muted px-3 py-2 text-sm text-fg-muted">
          <span className="font-semibold text-fg">Review note:</span> {request.reviewNote}
        </div>
      )}

      <div className="space-y-2">
        {request.lines.map((l) => {
          const s = signalById.get(l.materialId)
          const budgeted = s?.budgetedQty ?? null
          const remaining = budgeted == null ? null : budgeted - (s?.requestedSoFar ?? 0)
          return (
            <div key={l.id} className="rounded-lg border border-border bg-surface p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-fg">{l.material.name}</span>
                <span className="tabular-nums text-sm text-fg">
                  {fmtQty(Number(l.requestedQty))} {l.unit}
                  {reviewed && l.approvedQty != null && (
                    <span className="ml-2 text-fg-muted">→ approved {fmtQty(Number(l.approvedQty))}</span>
                  )}
                </span>
              </div>
              <p className="mt-1 text-[11px] tabular-nums text-fg-subtle">
                {budgeted == null
                  ? `no budget set · ${fmtQty(s?.requestedSoFar ?? 0)} requested so far`
                  : `${fmtQty(s?.requestedSoFar ?? 0)} of ${fmtQty(budgeted)} ${l.unit} requested · ${fmtQty(Math.max(0, remaining ?? 0))} left`}
                {s && s.pending > 0 ? ` · ${fmtQty(s.pending)} pending` : ''}
              </p>
              {l.note && <p className="mt-1 text-xs text-fg-muted">{l.note}</p>}
            </div>
          )
        })}
      </div>

      <RequestActions id={request.id} status={request.status} />
    </div>
  )
}
