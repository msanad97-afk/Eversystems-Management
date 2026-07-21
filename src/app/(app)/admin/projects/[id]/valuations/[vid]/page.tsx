import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireAdminPage } from '@/lib/auth/permissions'
import { loadValuation, loadRevisionHistory, certifyBlockers } from '@/lib/valuation.server'
import {
  CertifyGatePanel, ValuationCertificate, ValuationStatusBadge, RevisionHistoryStrip,
} from '@/components/admin/ValuationPanels'
import { ValuationActions } from '@/components/admin/ValuationActions'

export const dynamic = 'force-dynamic'

/** One certificate revision — draft, certified, or superseded. ADMIN-only. */
export default async function ValuationDetailPage({ params }: { params: { id: string; vid: string } }) {
  await requireAdminPage()

  const project = await prisma.project.findUnique({ where: { id: params.id }, select: { id: true, projectCode: true, name: true } })
  if (!project) notFound()

  const valuation = await loadValuation(project.id, params.vid)
  if (!valuation) notFound()

  const [history, blockers] = await Promise.all([
    loadRevisionHistory(project.id, new Date(`${valuation.periodMonth}T00:00:00.000Z`)),
    certifyBlockers(project.id),
  ])
  const supersededBy = valuation.supersededAt == null ? null : history.find((h) => h.revisionNumber > valuation.revisionNumber)

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
