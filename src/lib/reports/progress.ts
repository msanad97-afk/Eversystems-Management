import type { ReportStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { capRemaining, cumulativePercent } from '@/lib/reports/rules'

/**
 * Activity progress data access (Phase R). Two cumulative figures:
 *   - committed = Σ quantityDone over SUBMITTED + APPROVED report-activities — used for
 *     the BOQ cap (prevents over-reporting while reviews are pending);
 *   - earned    = Σ quantityDone over APPROVED only — the official progress used by
 *     history %, dashboards, and Phase 6–9 EVM.
 * The cap is project-wide per activity across all authors.
 */

const COMMITTED: ReportStatus[] = ['SUBMITTED', 'APPROVED']
const EARNED: ReportStatus[] = ['APPROVED']

async function sumByActivity(
  activityIds: string[],
  statuses: ReportStatus[],
  excludeReportId?: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (activityIds.length === 0) return out
  const rows = await prisma.reportActivity.groupBy({
    by: ['activityId'],
    where: {
      activityId: { in: activityIds },
      report: { status: { in: statuses } },
      ...(excludeReportId ? { reportId: { not: excludeReportId } } : {}),
    },
    _sum: { quantityDone: true },
  })
  for (const r of rows) out.set(r.activityId, Number(r._sum.quantityDone ?? 0))
  return out
}

export interface ScopeActivity {
  id: string
  ref: string | null
  name: string
  unit: string
  boqQuantity: number
  earned: number
  committed: number
  remaining: number
}
export interface ScopeAsset {
  id: string
  ref: string | null
  name: string
  activities: ScopeActivity[]
}

/**
 * Loads the project's active assets→activities with per-activity BOQ / earned /
 * committed / remaining, for the report form pick-list (cap computed EXCLUDING the
 * report being edited). Only assets that have at least one active activity are returned.
 */
export async function loadReportableScope(
  projectId: string,
  excludeReportId?: string,
): Promise<ScopeAsset[]> {
  // Rev 2: only MEASURED activities are reportable through this form (LUMPSUM reporting
  // arrives in Phase C2), so lumpsum lines never appear in the report pick-list.
  const assets = await prisma.asset.findMany({
    where: { projectId, isActive: true, activities: { some: { isActive: true, type: 'MEASURED' } } },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      ref: true,
      name: true,
      activities: {
        where: { isActive: true, type: 'MEASURED' },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, ref: true, name: true, unit: true, boqQuantity: true },
      },
    },
  })

  const activityIds = assets.flatMap((a) => a.activities.map((x) => x.id))
  const [committed, earned] = await Promise.all([
    sumByActivity(activityIds, COMMITTED, excludeReportId),
    sumByActivity(activityIds, EARNED),
  ])

  return assets.map((asset) => ({
    id: asset.id,
    ref: asset.ref,
    name: asset.name,
    activities: asset.activities.map((act) => {
      const boq = Number(act.boqQuantity)
      const committedQ = committed.get(act.id) ?? 0
      return {
        id: act.id,
        ref: act.ref,
        name: act.name,
        unit: act.unit ?? '',
        boqQuantity: boq,
        earned: earned.get(act.id) ?? 0,
        committed: committedQ,
        remaining: capRemaining(boq, committedQ),
      }
    }),
  }))
}

/** Per-activity BOQ / committed / remaining for a specific set of activity ids (any active state). */
export async function remainingByActivity(
  activityIds: string[],
  excludeReportId?: string,
): Promise<Map<string, { boqQuantity: number; committed: number; remaining: number }>> {
  const map = new Map<string, { boqQuantity: number; committed: number; remaining: number }>()
  if (activityIds.length === 0) return map
  const [acts, committed] = await Promise.all([
    prisma.activity.findMany({ where: { id: { in: activityIds } }, select: { id: true, boqQuantity: true } }),
    sumByActivity(activityIds, COMMITTED, excludeReportId),
  ])
  for (const a of acts) {
    const boq = Number(a.boqQuantity)
    const c = committed.get(a.id) ?? 0
    map.set(a.id, { boqQuantity: boq, committed: c, remaining: capRemaining(boq, c) })
  }
  return map
}

/** Earned (APPROVED-only) quantity per activity id — for cumulative-% display on read views. */
export async function earnedByActivity(activityIds: string[]): Promise<Map<string, number>> {
  return sumByActivity(activityIds, EARNED)
}

/**
 * Scope for the report FORM: the project's active scope PLUS any activities already on
 * the report that have since been deactivated (so an in-progress draft keeps showing
 * them). Remaining excludes the report being edited.
 */
export async function loadFormScope(
  projectId: string,
  referencedActivityIds: string[],
  excludeReportId?: string,
): Promise<ScopeAsset[]> {
  const scope = await loadReportableScope(projectId, excludeReportId)
  const present = new Set(scope.flatMap((a) => a.activities.map((x) => x.id)))
  const missing = referencedActivityIds.filter((id) => !present.has(id))
  if (missing.length === 0) return scope

  const [acts, remaining, earned] = await Promise.all([
    prisma.activity.findMany({
      where: { id: { in: missing } },
      select: { id: true, ref: true, name: true, unit: true, boqQuantity: true, asset: { select: { id: true, ref: true, name: true } } },
    }),
    remainingByActivity(missing, excludeReportId),
    earnedByActivity(missing),
  ])

  const byAsset = new Map(scope.map((a) => [a.id, a]))
  for (const act of acts) {
    let asset = byAsset.get(act.asset.id)
    if (!asset) {
      asset = { id: act.asset.id, ref: act.asset.ref, name: act.asset.name, activities: [] }
      byAsset.set(asset.id, asset)
      scope.push(asset)
    }
    const r = remaining.get(act.id)
    asset.activities.push({
      id: act.id,
      ref: act.ref,
      name: act.name,
      unit: act.unit ?? '',
      boqQuantity: Number(act.boqQuantity),
      earned: earned.get(act.id) ?? 0,
      committed: r?.committed ?? 0,
      remaining: r?.remaining ?? 0,
    })
  }
  return scope
}

/** Whether a project has at least one active activity (mandatory-setup gate). */
export async function projectHasActiveActivities(projectId: string): Promise<boolean> {
  const count = await prisma.activity.count({
    where: { isActive: true, type: 'MEASURED', asset: { projectId, isActive: true } },
  })
  return count > 0
}

export interface LedgerEntry {
  reportId: string
  reportCode: string
  date: string
  author: string
  status: ReportStatus
  quantityDone: number
  cumulative: number // running committed cumulative up to and including this entry
}
export interface ActivityLedger {
  activity: { id: string; ref: string | null; name: string; unit: string; assetName: string; projectId: string }
  header: { boqQuantity: number; earned: number; committed: number; percent: number; remaining: number }
  entries: LedgerEntry[]
}

/**
 * Full progress ledger for an activity. Lists SUBMITTED + APPROVED entries in date
 * order with a running committed cumulative; the header shows earned (APPROVED-only)
 * qty, %, and remaining. Returns null if the activity does not exist.
 */
export async function activityLedger(activityId: string): Promise<ActivityLedger | null> {
  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    select: {
      id: true,
      ref: true,
      name: true,
      unit: true,
      boqQuantity: true,
      asset: { select: { name: true, projectId: true } },
    },
  })
  if (!activity) return null

  const rows = await prisma.reportActivity.findMany({
    where: { activityId, report: { status: { in: COMMITTED } } },
    orderBy: [{ report: { reportDate: 'asc' } }, { report: { createdAt: 'asc' } }],
    select: {
      quantityDone: true,
      report: {
        select: {
          id: true,
          reportCode: true,
          reportDate: true,
          status: true,
          author: { select: { firstName: true, lastName: true } },
        },
      },
    },
  })

  let running = 0
  let earned = 0
  const entries: LedgerEntry[] = rows.map((r) => {
    const q = Number(r.quantityDone)
    running += q
    if (r.report.status === 'APPROVED') earned += q
    return {
      reportId: r.report.id,
      reportCode: r.report.reportCode,
      date: r.report.reportDate.toISOString().slice(0, 10),
      author: `${r.report.author.firstName} ${r.report.author.lastName}`,
      status: r.report.status,
      quantityDone: q,
      cumulative: running,
    }
  })

  const boq = Number(activity.boqQuantity)
  return {
    activity: {
      id: activity.id,
      ref: activity.ref,
      name: activity.name,
      unit: activity.unit ?? '',
      assetName: activity.asset.name,
      projectId: activity.asset.projectId,
    },
    header: {
      boqQuantity: boq,
      earned,
      committed: running,
      percent: cumulativePercent(earned, boq),
      remaining: capRemaining(boq, running),
    },
    entries,
  }
}
