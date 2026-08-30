import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdminPage } from '@/lib/auth/permissions'
import { prisma } from '@/lib/prisma'
import { loadScopeSignals } from '@/lib/materialRequests/signals.server'
import { loadMaterialCostRates, lineCost } from '@/lib/materialRequests/cost.server'
import { fmtQty, scopeChain } from '@/components/materialRequests/types'
import { MaterialRequestStatusBadge } from '@/components/materialRequests/MaterialRequestStatusBadge'
import { ReviewRequestClient, type ReviewLineData } from '@/components/materialRequests/ReviewRequestClient'
import { SendEmailDialog } from '@/components/email/SendEmailDialog'
import { EmailHistory } from '@/components/email/EmailHistory'
import { loadEmailSends, loadRecipientCandidates } from '@/lib/email/history.server'

export const dynamic = 'force-dynamic'

function fmtBhd(n: number): string {
  return `BHD ${n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`
}

export default async function AdminReviewRequestPage({ params }: { params: { id: string } }) {
  await requireAdminPage()

  const request = await prisma.materialRequest.findUnique({
    where: { id: params.id },
    select: {
      id: true, requestCode: true, status: true, reviewNote: true, projectId: true, assetId: true, activityId: true,
      project: { select: { name: true } },
      asset: { select: { name: true } },
      activity: { select: { name: true, ref: true } },
      requestedBy: { select: { firstName: true, lastName: true } },
      lines: { orderBy: { sortOrder: 'asc' }, select: { id: true, materialId: true, unit: true, requestedQty: true, approvedQty: true, note: true, material: { select: { name: true } } } },
    },
  })
  if (!request) notFound()

  const [signals, costRates] = await Promise.all([
    loadScopeSignals({ projectId: request.projectId, assetId: request.assetId, activityId: request.activityId }, request.id),
    loadMaterialCostRates(request.lines.map((l) => l.materialId)), // ADMIN-only
  ])
  const signalById = new Map(signals.map((s) => [s.materialId, s]))
  const scope = scopeChain(request.asset?.name, request.activity ? `${request.activity.ref ? `${request.activity.ref} · ` : ''}${request.activity.name}` : null)
  const reviewed = request.status !== 'SUBMITTED'

  const header = (
    <div>
      <Link href="/admin/requests" className="text-sm font-medium text-primary-700 hover:underline">← Material requests</Link>
      <div className="mt-1 flex items-center justify-between">
        <div>
          <p className="mono text-xs text-fg-subtle">{request.requestCode}</p>
          <h1 className="text-xl font-semibold text-fg">{request.project.name}</h1>
          <p className="text-sm text-fg-muted">{scope} · by {request.requestedBy.firstName} {request.requestedBy.lastName}</p>
        </div>
        <MaterialRequestStatusBadge status={request.status} />
      </div>
    </div>
  )

  if (!reviewed) {
    const lines: ReviewLineData[] = request.lines.map((l) => {
      const s = signalById.get(l.materialId)
      return {
        lineId: l.id,
        materialName: l.material.name,
        unit: l.unit,
        requestedQty: Number(l.requestedQty),
        note: l.note,
        budgetedQty: s?.budgetedQty ?? null,
        requestedSoFar: s?.requestedSoFar ?? 0,
        pending: s?.pending ?? 0,
        unitRate: costRates.get(l.materialId) ?? null,
      }
    })
    return (
      <div className="space-y-5">
        {header}
        <ReviewRequestClient id={request.id} lines={lines} />
      </div>
    )
  }

  // Reviewed → immutable read-only summary (with cost, ADMIN).
  let totalCost = 0
  const printable = request.status === 'APPROVED' || request.status === 'PARTIALLY_APPROVED'
  // Emailing the letter out is an ADMIN action (this whole page is admin-only) and needs an
  // approved quantity to send — a fully rejected request has no letter.
  const [emailSends, recipientCandidates] = await Promise.all([
    loadEmailSends('MATERIAL_REQUEST', request.id),
    printable ? loadRecipientCandidates() : Promise.resolve([]),
  ])
  return (
    <div className="space-y-5">
      {header}
      {/* Same quantities-only procurement letter the supervisor prints. */}
      {printable && (
        <div className="flex items-center justify-end gap-4">
          <a href={`/api/material-requests/${request.id}/pdf`} target="_blank" rel="noreferrer" className="text-sm font-medium text-primary-700 hover:underline">
            Download PDF
          </a>
          <SendEmailDialog
            entityType="MATERIAL_REQUEST"
            entityId={request.id}
            entityCode={request.requestCode}
            attachmentName={`${request.requestCode}.pdf`}
            users={recipientCandidates}
          />
        </div>
      )}
      <EmailHistory sends={emailSends} />
      {request.reviewNote && (
        <div className="rounded-md border border-border bg-surface-muted px-3 py-2 text-sm text-fg-muted">
          <span className="font-semibold text-fg">Review note:</span> {request.reviewNote}
        </div>
      )}
      <div className="space-y-2">
        {request.lines.map((l) => {
          const rate = costRates.get(l.materialId) ?? null
          const appr = l.approvedQty == null ? 0 : Number(l.approvedQty)
          const cost = lineCost(appr, rate)
          if (cost != null) totalCost += cost
          return (
            <div key={l.id} className="rounded-lg border border-border bg-surface p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-fg">{l.material.name}</span>
                <span className="tabular-nums text-sm text-fg">
                  {fmtQty(Number(l.requestedQty))} {l.unit} → <span className="font-medium">approved {fmtQty(appr)}</span>
                </span>
              </div>
              <p className="mt-1 text-xs text-fg-muted">Cost: <span className="tabular-nums">{cost == null ? 'unpriced' : fmtBhd(cost)}</span></p>
            </div>
          )
        })}
      </div>
      <div className="flex items-center justify-between rounded-lg border border-border bg-surface p-4">
        <span className="text-sm font-medium text-fg">Total approved cost</span>
        <span className="tabular-nums text-sm font-semibold text-fg">{fmtBhd(totalCost)}</span>
      </div>
    </div>
  )
}
