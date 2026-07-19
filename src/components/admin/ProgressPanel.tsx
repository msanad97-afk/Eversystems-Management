import Link from 'next/link'
import type { ProjectProgress } from '@/lib/dashboard'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { ProgressBar } from '@/components/admin/ProgressBar'

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/**
 * Physical progress. With no project filter → a per-project physical-% summary (each row
 * links to that project). With a single project filtered → the asset→activity breakdown.
 * Physical % is the unweighted mean of activity %s (upgrades to value-weighted in Phase 6).
 */
export function ProgressPanel({
  progress,
  selectedProjectId,
}: {
  progress: ProjectProgress[]
  selectedProjectId: string
}) {
  if (progress.length === 0) {
    return (
      <EmptyState
        title="No physical progress yet"
        description="Active projects need assets & activities (and approved reports) to show progress."
      />
    )
  }

  // Single project selected → asset→activity breakdown.
  if (selectedProjectId) {
    const p = progress.find((x) => x.projectId === selectedProjectId) ?? progress[0]!
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-fg">{p.projectName} — physical % complete</p>
            <span className="text-2xl font-semibold text-fg">{round1(p.physicalPercent)}%</span>
          </div>
          <ProgressBar percent={p.physicalPercent} className="mt-2" />
          <p className="mt-1 text-xs text-fg-subtle">Unweighted mean of {p.activityCount} activities&apos; % (value-weighting arrives with rates in Phase 6).</p>
        </div>

        {p.assets.map((asset) => (
          <div key={asset.assetId} className="space-y-2">
            <h3 className="text-sm font-semibold text-fg">{asset.assetName}</h3>
            <Table>
              <THead>
                <TR>
                  <TH>Activity</TH>
                  <TH>Unit</TH>
                  <TH className="text-right">BOQ</TH>
                  <TH className="text-right">Earned</TH>
                  <TH className="text-right">Remaining</TH>
                  <TH>%</TH>
                </TR>
              </THead>
              <TBody>
                {asset.activities.map((a) => (
                  <TR key={a.activityId}>
                    <TD>{a.ref ? `${a.ref} · ` : ''}{a.name}</TD>
                    <TD className="text-fg-muted">{a.unit}</TD>
                    <TD className="text-right tabular-nums">{a.boqQuantity}</TD>
                    <TD className="text-right tabular-nums">{round1(a.earned)}</TD>
                    <TD className="text-right tabular-nums">{round1(a.remaining)}</TD>
                    <TD>
                      <div className="flex items-center gap-2">
                        <ProgressBar percent={a.percent} className="w-24" />
                        <span className="tabular-nums text-xs text-fg-muted">{round1(a.percent)}%</span>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        ))}
      </div>
    )
  }

  // All projects → per-project physical-% summary.
  return (
    <Table>
      <THead>
        <TR>
          <TH>Project</TH>
          <TH>Activities</TH>
          <TH>Physical % complete</TH>
        </TR>
      </THead>
      <TBody>
        {progress.map((p) => (
          <TR key={p.projectId}>
            <TD className="whitespace-nowrap font-medium">
              <Link href={`/admin?projectId=${p.projectId}`} className="hover:underline">{p.projectName}</Link>
            </TD>
            <TD className="text-fg-muted">{p.activityCount}</TD>
            <TD>
              <div className="flex items-center gap-2">
                <ProgressBar percent={p.physicalPercent} className="w-40" />
                <span className="tabular-nums text-sm font-medium text-fg">{round1(p.physicalPercent)}%</span>
              </div>
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  )
}
