import Link from 'next/link'
import type { ProjectEvm, EvmNode } from '@/lib/evm.server'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { Badge } from '@/components/ui/Badge'

const bhd = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })
const bhd0 = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })

/** Index colouring against 1.0: green ≥ 1.0, amber 0.9–1.0, red < 0.9. */
function indexTone(v: number | null): string {
  if (v == null) return 'text-fg-subtle'
  if (v >= 1) return 'text-success'
  if (v >= 0.9) return 'text-warning'
  return 'text-danger'
}
const idx = (v: number | null) => (v == null ? 'N/A' : v.toFixed(2))

function Kpi({ label, value, tone, sub }: { label: string; value: string; tone?: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${tone ?? 'text-fg'}`}>{value}</p>
      {sub && <p className="text-xs text-fg-subtle">{sub}</p>}
    </div>
  )
}

/** KPI row. SPI/PV read "N/A"/"No baseline set" rather than a fabricated number. */
export function EvmKpiRow({ evm }: { evm: ProjectEvm }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Kpi label="BAC" value={`BHD ${bhd0(evm.bac)}`} sub="budget at completion" />
      <Kpi label="PV" value={evm.pv == null ? 'No baseline set' : `BHD ${bhd0(evm.pv)}`} sub="planned value" />
      <Kpi label="EV" value={`BHD ${bhd0(evm.ev)}`} sub={`${evm.pctComplete}% complete`} />
      <Kpi label="AC (direct)" value={`BHD ${bhd0(evm.ac)}`} sub="approved field cost" />
      <Kpi label="% complete" value={`${evm.pctComplete}%`} sub="value-weighted" />
      <Kpi label="SPI" value={idx(evm.spi)} tone={indexTone(evm.spi)} sub={evm.spi == null ? 'no baseline' : 'schedule index'} />
      <Kpi label="CPI" value={idx(evm.cpi)} tone={indexTone(evm.cpi)} sub={evm.cpi == null ? 'no cost yet' : 'cost index'} />
      <Kpi label="EAC" value={`BHD ${bhd0(evm.eac)}`} sub={`independent ${bhd0(evm.eacIndependent)}`} />
      <Kpi label="VAC" value={`BHD ${bhd0(evm.vac)}`} tone={evm.vac < 0 ? 'text-danger' : 'text-success'} sub="budget − EAC" />
      <Kpi label="ETC" value={`BHD ${bhd0(evm.etc)}`} sub="cost to finish" />
    </div>
  )
}

/**
 * Data-quality banners — reuse the 6A/6B warnings rather than inventing new ones. Unpriced
 * scope contributes 0 to BV *and* EV, so CPI can look healthy on incomplete figures.
 */
export function EvmDataQuality({ evm }: { evm: ProjectEvm }) {
  if (evm.unpricedCount === 0 && !evm.hasApproximations) return null
  return (
    <div className="space-y-2">
      {evm.unpricedCount > 0 && (
        <div className="rounded-lg border border-danger bg-danger-bg px-4 py-3 text-sm text-danger">
          <span className="font-semibold">{evm.unpricedCount} unpriced item(s) — these EVM figures are understated.</span>{' '}
          Unpriced scope contributes nothing to budget or earned value, so CPI can look healthy while the numbers are incomplete.
          Price them in Catalogs, then re-price the affected activities.
        </div>
      )}
      {evm.hasApproximations && (
        <div className="rounded-lg border border-warning bg-warning-bg px-4 py-3 text-sm text-warning">
          <span className="font-semibold">BHD {bhd(evm.approximatedCost)} of actual cost is an approximation</span>{' '}
          (backfilled at today&apos;s rates, not the rates at approval), so AC, CPI and EAC below carry that estimate.
        </div>
      )}
    </div>
  )
}

/**
 * Asset breakdown — COST performance only. There is no per-asset baseline, so PV/SPI/SV are
 * deliberately absent rather than synthesised by allocating the project curve (the same
 * distortion we refused when keeping overhead out of CPI).
 */
export function AssetEvmTable({ assets, projectId }: { assets: EvmNode[]; projectId: string }) {
  if (assets.length === 0) return null
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-fg">By asset <span className="font-normal text-fg-subtle">— cost performance (schedule indices are project-level)</span></h3>
      <Table>
        <THead>
          <TR>
            <TH>Asset</TH><TH className="text-right">BAC</TH><TH className="text-right">EV</TH><TH className="text-right">AC</TH>
            <TH className="text-right">CV</TH><TH className="text-right">CPI</TH><TH className="text-right">EAC</TH><TH className="text-right">VAC</TH><TH className="text-right">%</TH><TH></TH>
          </TR>
        </THead>
        <TBody>
          {assets.map((a) => (
            <TR key={a.id}>
              <TD className="font-medium">{a.name}</TD>
              <TD className="text-right tabular-nums">{bhd0(a.bac)}</TD>
              <TD className="text-right tabular-nums">{bhd0(a.ev)}</TD>
              <TD className="text-right tabular-nums">{bhd0(a.ac)}</TD>
              <TD className={`text-right tabular-nums ${a.cv < 0 ? 'text-danger' : ''}`}>{bhd0(a.cv)}</TD>
              <TD className={`text-right tabular-nums ${indexTone(a.cpi)}`}>{idx(a.cpi)}</TD>
              <TD className="text-right tabular-nums">{bhd0(a.eac)}</TD>
              <TD className={`text-right tabular-nums ${a.vac < 0 ? 'text-danger' : ''}`}>{bhd0(a.vac)}</TD>
              <TD className="text-right tabular-nums">{a.pctComplete}%</TD>
              <TD>
                <Link href={`/admin/projects/${projectId}/performance?assetId=${a.id}`} className="text-xs font-medium text-primary hover:underline">
                  Activities
                </Link>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  )
}

export function ActivityEvmTable({ assetName, activities }: { assetName: string; activities: EvmNode[] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-fg">{assetName} — activities</h3>
      <Table>
        <THead>
          <TR>
            <TH>Activity</TH><TH className="text-right">BAC</TH><TH className="text-right">EV</TH><TH className="text-right">AC</TH>
            <TH className="text-right">CV</TH><TH className="text-right">CPI</TH><TH className="text-right">EAC</TH><TH className="text-right">VAC</TH><TH className="text-right">%</TH>
          </TR>
        </THead>
        <TBody>
          {activities.map((a) => (
            <TR key={a.id}>
              <TD className="font-medium">{a.ref ? `${a.ref} · ` : ''}{a.name}</TD>
              <TD className="text-right tabular-nums">{bhd0(a.bac)}</TD>
              <TD className="text-right tabular-nums">{bhd0(a.ev)}</TD>
              <TD className="text-right tabular-nums">{bhd0(a.ac)}</TD>
              <TD className={`text-right tabular-nums ${a.cv < 0 ? 'text-danger' : ''}`}>{bhd0(a.cv)}</TD>
              <TD className={`text-right tabular-nums ${indexTone(a.cpi)}`}>{idx(a.cpi)}</TD>
              <TD className="text-right tabular-nums">{bhd0(a.eac)}</TD>
              <TD className={`text-right tabular-nums ${a.vac < 0 ? 'text-danger' : ''}`}>{bhd0(a.vac)}</TD>
              <TD className="text-right tabular-nums">{a.pctComplete}%</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  )
}

/**
 * Total project economics — kept visually SEPARATE from the EVM block. Overhead belongs in
 * the all-in number but must never reach CPI (6C.5).
 */
export function ProjectEconomicsPanel({ evm }: { evm: ProjectEvm }) {
  const negative = evm.projectedMargin < 0
  return (
    <div className="rounded-lg border border-border-strong bg-surface-subtle p-4">
      <h3 className="text-sm font-semibold text-fg">Total project economics</h3>
      <p className="text-xs text-fg-subtle">
        The all-in view. Overhead is included here but deliberately excluded from CPI above, which measures direct field productivity only.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Contract value" value={`BHD ${bhd0(evm.contractValue)}`} sub="bottom-up" />
        <Kpi label="Forecast direct cost" value={`BHD ${bhd0(evm.eac)}`} sub="EAC" />
        <Kpi label="Overhead / indirect" value={`BHD ${bhd0(evm.expensesTotal)}`} sub="eligible expenses" />
        <Kpi
          label="Projected margin"
          value={`BHD ${bhd0(evm.projectedMargin)}`}
          tone={negative ? 'text-danger' : 'text-success'}
          sub="contract − EAC − overhead"
        />
      </div>
      {negative && (
        <p className="mt-2">
          <Badge tone="danger">Forecast loss</Badge>
        </p>
      )}
    </div>
  )
}
