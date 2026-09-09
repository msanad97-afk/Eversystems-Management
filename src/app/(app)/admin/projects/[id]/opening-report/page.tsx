import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdminPage } from '@/lib/auth/permissions'
import { prisma } from '@/lib/prisma'
import { loadFormScope } from '@/lib/reports/progress'
import { openingReportDateError, defaultOpeningDate } from '@/lib/reports/opening'
import { earliestReportDate, openingReopenGate } from '@/lib/reports/opening.server'
import { addDays } from '@/lib/datetime'
import { OpeningReportEditor, type OpeningScopeActivity } from '@/components/reports/OpeningReportEditor'
import { CreateOpeningReport } from '@/components/reports/CreateOpeningReport'
import { ReopenOpeningReport } from '@/components/reports/ReopenOpeningReport'

export const dynamic = 'force-dynamic'

const round3 = (n: number) => Math.round(n * 1000) / 1000
const iso = (d: Date) => d.toISOString().slice(0, 10)

export default async function OpeningReportPage({ params }: { params: { id: string } }) {
  await requireAdminPage()

  const project = await prisma.project.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, projectCode: true, startDate: true },
  })
  if (!project) notFound()

  const existing = await prisma.dailyReport.findFirst({
    where: { projectId: project.id, isOpeningBalance: true },
    select: {
      id: true, reportCode: true, status: true, reportDate: true,
      activities: {
        select: {
          activityId: true, openingLabourCost: true,
          subActivities: { select: { subActivityId: true, quantityDone: true, percentComplete: true, materials: { select: { materialId: true, quantity: true } } } },
        },
      },
    },
  })

  const header = (
    <div>
      <Link href={`/admin/projects/${project.id}`} className="text-sm font-medium text-primary-700 hover:underline">← {project.name}</Link>
      <h1 className="mt-1 text-xl font-semibold text-fg">Opening balance</h1>
      <p className="text-sm text-fg-subtle">Work executed before go-live. A normal report carrying a flag — it feeds EVM, the matrix, valuations and inventory like any approved report.</p>
    </div>
  )

  // Date bounds: on/after the project start date, strictly before the earliest recorded report (so the
  // opening balance sits immediately behind the history with no gap). Default = the day before it.
  const earliest = await earliestReportDate(project.id, existing?.id)
  const startStr = project.startDate ? iso(project.startDate) : null
  const maxStr = earliest ? iso(addDays(earliest, -1)) : null

  // No opening report yet → offer to create it (blocked if there is no start date to date it at).
  if (!existing) {
    const dateError = openingReportDateError(project.startDate)
    return (
      <div className="space-y-5">
        {header}
        {dateError ? (
          <div className="rounded-lg border border-warning bg-warning-bg px-4 py-3 text-sm text-warning">{dateError}</div>
        ) : (
          <CreateOpeningReport projectId={project.id} defaultDate={iso(defaultOpeningDate(project.startDate!, earliest))} minDate={startStr!} maxDate={maxStr} />
        )}
      </div>
    )
  }

  // Build the entry scope (assets → activities → active subs) with the budget-derived material
  // pre-fill (qtyPerUnit × BOQ = the 100% estimate), reusing loadFormScope's derivation.
  const scope = await loadFormScope(project.id, existing.id)
  const activities: OpeningScopeActivity[] = scope.flatMap((asset) =>
    asset.activities.map((act) => ({
      activityId: act.id,
      assetName: asset.name,
      ref: act.ref,
      name: act.name,
      unit: act.unit,
      subs: act.subActivities
        .filter((s) => !s.isImplicit || act.subActivities.length === 1) // keep the implicit sub only when it is the sole reportable line
        .map((s) => ({
          subActivityId: s.id,
          name: s.isImplicit ? 'Progress' : s.name,
          type: s.type,
          boqQuantity: s.boqQuantity,
          materials: s.budgetMaterials.map((m) => ({ materialId: m.materialId, materialName: m.materialName, unit: m.unit, estimateQty: round3(m.qtyPerUnit * s.boqQuantity) })),
        })),
    })),
  )

  const initial = {
    id: existing.id,
    reportCode: existing.reportCode,
    status: existing.status,
    reportDate: existing.reportDate.toISOString().slice(0, 10),
    labourByActivity: Object.fromEntries(existing.activities.map((a) => [a.activityId, a.openingLabourCost == null ? 0 : Number(a.openingLabourCost)])),
    subEntries: existing.activities.flatMap((a) => a.subActivities.map((s) => ({
      subActivityId: s.subActivityId,
      quantityDone: s.quantityDone == null ? null : Number(s.quantityDone),
      percentComplete: s.percentComplete == null ? null : Number(s.percentComplete),
      materials: s.materials.map((m) => ({ materialId: m.materialId, quantity: Number(m.quantity) })),
    }))),
  }

  // When the opening report is APPROVED, offer a gated re-open (or explain why it is blocked).
  const reopen = existing.status === 'APPROVED'
    ? await openingReopenGate({ id: existing.id, isOpeningBalance: true, status: existing.status, projectId: project.id, reportDate: existing.reportDate })
    : null

  return (
    <div className="space-y-5">
      {header}
      <div className="rounded-lg border border-border bg-surface-subtle px-4 py-3 text-sm text-fg">
        Labour here is a <span className="font-semibold">direct cost with no man-hours</span>. Cumulative man-hours for this project will be understated by the pre-go-live period — that is expected, and flagged wherever man-hours appear.
      </div>
      {reopen && (reopen.ok
        ? <ReopenOpeningReport reportId={existing.id} />
        : <div className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-fg-muted"><span className="font-medium text-fg">Re-open unavailable.</span> {reopen.reason}</div>
      )}
      <OpeningReportEditor activities={activities} initial={initial} minDate={startStr} maxDate={maxStr} />
    </div>
  )
}
