import { requireAdminPage } from '@/lib/auth/permissions'
import { prisma } from '@/lib/prisma'
import { loadInventory } from '@/lib/inventory/inventoryView.server'
import { InventoryFilters } from '@/components/inventory/InventoryFilters'

export const dynamic = 'force-dynamic'

const one = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v)

const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, ''))
const fmtDate = (d: Date | null) => (d ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
// Count adjustment from the site's perspective: em dash when none, signed with unit otherwise.
const fmtAdj = (adj: number, unit: string) => (adj === 0 ? '—' : `${adj > 0 ? '+' : ''}${fmtQty(adj)} ${unit}`)

/** One labelled figure inside a mobile inventory card. */
function Field({ label, value, valueClass = 'text-fg' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-fg-subtle">{label}</dt>
      <dd className={`tabular-nums ${valueClass}`}>{value}</dd>
    </div>
  )
}

export default async function AdminInventoryPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  await requireAdminPage()
  const projectId = one(searchParams.projectId) ?? ''

  const [groups, projects] = await Promise.all([
    loadInventory(projectId || undefined),
    prisma.project.findMany({ where: { status: 'ACTIVE' }, orderBy: { projectCode: 'asc' }, select: { id: true, name: true, projectCode: true } }),
  ])

  const anyRows = groups.some((g) => g.rows.length > 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-fg">Inventory</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Derived on-hand balance per material: delivered minus consumed. Quantities only.
        </p>
      </div>

      <InventoryFilters projects={projects} projectId={projectId} />

      {!anyRows && <p className="text-sm text-fg-subtle">No inventory movement recorded yet for the selected scope.</p>}

      {groups.filter((g) => g.rows.length > 0).map((g) => (
        <section key={g.projectId} className="space-y-2">
          <h2 className="text-sm font-semibold text-fg">{g.projectName} <span className="font-normal text-fg-subtle">· {g.projectCode}</span></h2>

          {/* Mobile (< md): a stacked card per material. Seven numeric columns side-scrolling on a
              phone would push the material name (the row's identity) off-screen; cards keep every
              figure labelled and the identity always visible. Desktop keeps the table below. */}
          <div className="space-y-2 md:hidden">
            {g.rows.map((r) => {
              const negative = r.onHand < 0
              const adj = r.countAdjustment
              return (
                <div key={r.materialId} className={`rounded-lg border border-border p-3 ${negative ? 'bg-danger-bg' : 'bg-surface'}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-fg">{r.materialName}</span>
                    <span className={`text-sm font-medium tabular-nums ${negative ? 'text-danger' : 'text-fg'}`}>
                      {fmtQty(r.onHand)} {r.unit}{negative ? ' ⚠' : ''} on hand
                    </span>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                    <Field label="Delivered" value={`${fmtQty(r.delivered)} ${r.unit}`} valueClass="text-fg-muted" />
                    <Field label="Consumed" value={`${fmtQty(r.consumed)} ${r.unit}`} valueClass="text-fg-muted" />
                    <Field label="Count adj." value={fmtAdj(adj, r.unit)} valueClass={adj < 0 ? 'text-danger' : 'text-fg-muted'} />
                    <Field label="Estimated" value={`${fmtQty(r.estimatedPortion)} ${r.unit}`} valueClass="text-fg-subtle" />
                    <Field label="Actual" value={`${fmtQty(r.actualPortion)} ${r.unit}`} valueClass="text-fg-subtle" />
                    <Field label="Last counted" value={fmtDate(r.lastCountedAt)} valueClass="text-fg-muted" />
                  </dl>
                </div>
              )
            })}
          </div>

          <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th className="px-3 py-2 font-semibold">Material</th>
                  <th className="px-3 py-2 text-right font-semibold">Delivered</th>
                  <th className="px-3 py-2 text-right font-semibold">Consumed</th>
                  <th className="px-3 py-2 text-right font-semibold">Count adj.</th>
                  <th className="px-3 py-2 text-right font-semibold">On hand</th>
                  <th className="px-3 py-2 text-right font-semibold">Estimated</th>
                  <th className="px-3 py-2 text-right font-semibold">Actual</th>
                  <th className="px-3 py-2 font-semibold">Last counted</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => {
                  const negative = r.onHand < 0
                  const adj = r.countAdjustment // site perspective: + surplus, − shortfall
                  return (
                    <tr key={r.materialId} className={`border-b border-border last:border-0 ${negative ? 'bg-danger-bg' : ''}`}>
                      <td className="px-3 py-2 text-fg">{r.materialName}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-fg-muted">{fmtQty(r.delivered)} {r.unit}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-fg-muted">{fmtQty(r.consumed)} {r.unit}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${adj === 0 ? 'text-fg-subtle' : adj < 0 ? 'text-danger' : 'text-fg-muted'}`}>
                        {fmtAdj(adj, r.unit)}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums font-medium ${negative ? 'text-danger' : 'text-fg'}`}>
                        {fmtQty(r.onHand)} {r.unit}{negative ? ' ⚠' : ''}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-fg-subtle">{fmtQty(r.estimatedPortion)} {r.unit}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-fg-subtle">{fmtQty(r.actualPortion)} {r.unit}</td>
                      <td className="px-3 py-2 text-fg-muted">{fmtDate(r.lastCountedAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  )
}
