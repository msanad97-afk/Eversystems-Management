import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireAdminPage } from '@/lib/auth/permissions'
import { loadValuation, loadRevisionHistory, certifyBlockers } from '@/lib/valuation.server'
import { loadReceivables } from '@/lib/cash.server'
import {
  CertifyGatePanel, ValuationCertificate, ValuationStatusBadge, RevisionHistoryStrip,
} from '@/components/admin/ValuationPanels'
import { ValuationActions } from '@/components/admin/ValuationActions'
import { ValuationCashActions } from '@/components/admin/ValuationCashActions'

export const dynamic = 'force-dynamic'

const utcDay = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) }

/** One certificate revision — draft, certified, or superseded. ADMIN-only. */
export default async function ValuationDetailPage({ params }: { params: { id: string; vid: string } }) {
  await requireAdminPage()

  const project = await prisma.project.findUnique({ where: { id: params.id }, select: { id: true, projectCode: true, name: true } })
  if (!project) notFound()

  const valuation = await loadValuation(project.id, params.vid)
  if (!valuation) notFound()

  const [history, blockers, receivables, accounts, ownReceipts] = await Promise.all([
    loadRevisionHistory(project.id, new Date(`${valuation.periodMonth}T00:00:00.000Z`)),
    certifyBlockers(project.id),
    loadReceivables({ projectId: project.id, today: utcDay() }),
    prisma.bankAccount.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, currency: true } }),
    // Receipts matched to THIS revision specifically — used to explain a superseded revision that carries receipts.
    prisma.cashTransaction.aggregate({ where: { valuationId: params.vid, direction: 'IN' }, _sum: { amount: true }, _count: true }),
  ])
  const supersededBy = valuation.supersededAt == null ? null : history.find((h) => h.revisionNumber > valuation.revisionNumber)
  const periodRow = receivables.find((r) => r.periodMonth === valuation.periodMonth)
  const outstanding = periodRow?.outstanding ?? valuation.netPayable
  const ownReceiptTotal = ownReceipts._sum.amount == null ? 0 : Number(ownReceipts._sum.amount)

  return (
    <div className="space-y-5">
      <div>
        <Link href={`/admin/projects/${project.id}/valuations`} className="text-sm font-medium text-primary hover:underline">
          ← Valuations
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-fg">
                {new Date(`${valuation.periodMonth}T00:00:00.000Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}
              </h1>
              <ValuationStatusBadge status={valuation.status} />
              {valuation.revisionNumber > 0 && <span className="text-sm text-fg-subtle">rev {valuation.revisionNumber}</span>}
            </div>
            <p className="mono text-sm text-fg-subtle">{valuation.valuationCode} · {project.projectCode}</p>
          </div>
          <ValuationActions
            projectId={project.id}
            valuationId={valuation.id}
            status={valuation.status}
            superseded={valuation.supersededAt != null}
            blockers={blockers}
          />
        </div>
      </div>

      {valuation.supersededAt != null && (
        <div className="rounded-lg border border-warning bg-warning-bg px-4 py-3 text-sm text-warning">
          <span className="font-semibold">Superseded{supersededBy ? ` by rev ${supersededBy.revisionNumber}` : ''}.</span>{' '}
          This revision is read-only and kept exactly as it was — it is the record of what the client approved at the time.
          {ownReceiptTotal > 0 && (
            <> It carries {ownReceiptTotal.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} in
            receipts paid against it — those stay attached here as a historical fact, but this period&apos;s outstanding is
            measured against the current live revision&apos;s net payable, not this one.</>
          )}
        </div>
      )}

      {/* Payment-side actions on the live certified revision. */}
      {valuation.status === 'CERTIFIED' && valuation.supersededAt == null && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
          <div className="text-sm">
            <span className="text-fg-subtle">Outstanding on this period: </span>
            <span className={`font-medium tabular-nums ${outstanding < 0 ? 'text-danger' : 'text-fg'}`}>
              {outstanding.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
            </span>
            {valuation.invoicedAt && <span className="ml-3 text-xs text-fg-muted">invoiced {valuation.invoicedAt}</span>}
          </div>
          <ValuationCashActions
            projectId={project.id}
            valuationId={valuation.id}
            invoiced={valuation.invoicedAt != null}
            outstanding={outstanding}
            accounts={accounts}
          />
        </div>
      )}

      {valuation.status === 'DRAFT' && valuation.supersededAt == null && (
        <>
          <CertifyGatePanel blockers={blockers} />
          <p className="text-xs text-fg-subtle">
            This draft is computed from approved field progress as of the period&apos;s month-end. Recompute to pick up newly
            approved reports; nothing is frozen until it is certified.
          </p>
        </>
      )}

      <ValuationCertificate valuation={valuation} />

      <RevisionHistoryStrip projectId={project.id} currentId={valuation.id} history={history} />
    </div>
  )
}
