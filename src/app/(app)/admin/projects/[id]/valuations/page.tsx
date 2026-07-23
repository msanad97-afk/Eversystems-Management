import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireAdminPage } from '@/lib/auth/permissions'
import { listValuations, certifyBlockers } from '@/lib/valuation.server'
import { loadProjectEvm } from '@/lib/evm.server'
import { loadReceivables, loadAdvanceBlock, loadRetentionBlock } from '@/lib/cash.server'
import { CertifyGatePanel, ValuationList, RevenueVsEvPanel } from '@/components/admin/ValuationPanels'
import { ReceivablesTable, AdvanceBlockPanel, RetentionBlockPanel } from '@/components/admin/CashPanels'
import { NewValuationForm } from '@/components/admin/ValuationActions'
import { RetentionReleaseButton } from '@/components/admin/ValuationCashActions'

export const dynamic = 'force-dynamic'

const utcDay = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) }

/** Valuations (IPCs) — ADMIN-only; `requireAdminPage` redirects everyone else. */
export default async function ValuationsPage({ params }: { params: { id: string } }) {
  await requireAdminPage()

  const project = await prisma.project.findUnique({
    where: { id: params.id },
    select: { id: true, projectCode: true, name: true, currency: true },
  })
  if (!project) notFound()

  const [valuations, blockers, evm, receivables, advance, retention, accounts] = await Promise.all([
    listValuations(project.id),
    certifyBlockers(project.id),
    loadProjectEvm(project.id),
    loadReceivables({ projectId: project.id, today: utcDay() }),
    loadAdvanceBlock(project.id),
    loadRetentionBlock(project.id),
    prisma.bankAccount.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, currency: true } }),
  ])

  // The latest CERTIFIED cumulative gross — what the client has actually approved to date.
  const certifiedGross = valuations.find((v) => v.status === 'CERTIFIED')?.grossAmount ?? 0

  return (
    <div className="space-y-5">
      <div>
        <Link href={`/admin/projects/${project.id}`} className="text-sm font-medium text-primary hover:underline">
          ← {project.name}
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold text-fg">Valuations</h1>
            <p className="mono text-sm text-fg-subtle">{project.projectCode} · interim payment certificates ({project.currency})</p>
          </div>
          <NewValuationForm projectId={project.id} />
        </div>
      </div>

      <CertifyGatePanel blockers={blockers} />

      <ValuationList projectId={project.id} valuations={valuations} />

      {advance && <AdvanceBlockPanel advance={advance} />}

      {retention && (
        <RetentionBlockPanel
          retention={retention}
          action={<RetentionReleaseButton projectId={project.id} outstanding={retention.outstanding} accounts={accounts} />}
        />
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">Receivables &amp; ageing</h2>
        <ReceivablesTable rows={receivables} showProject={false} />
      </section>

      {evm && <RevenueVsEvPanel certifiedGross={certifiedGross} ev={evm.ev} ac={evm.ac} />}
    </div>
  )
}
