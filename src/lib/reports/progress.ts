import type { ReportStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { capRemaining, cumulativePercent } from '@/lib/reports/rules'

/**
 * Progress data access (Phase C2). Reporting is per SUB-ACTIVITY:
 *   - MEASURED sub: quantityDone increments toward a cap = the parent activity's BOQ.
 *       committed = Σ over SUBMITTED+APPROVED (drives the cap); earned = Σ over APPROVED.
 *   - LUMPSUM sub: percentComplete is cumulative 0–100; earned BHD = latest-approved % × BHD.
 * All figures are per sub-activity across all authors; drafts are excluded everywhere.
 */

const COMMITTED: ReportStatus[] = ['SUBMITTED', 'APPROVED']
const EARNED: ReportStatus[] = ['APPROVED']

/** Σ measured quantityDone per sub-activity over the given report statuses. */
async function sumBySubActivity(
  subActivityIds: string[],
  statuses: ReportStatus[],
  excludeReportId?: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (subActivityIds.length === 0) return out
  const rows = await prisma.reportSubActivity.groupBy({
    by: ['subActivityId'],
    where: {
      subActivityId: { in: subActivityIds },
      quantityDone: { not: null },
      reportActivity: {
        report: { status: { in: statuses } },
        ...(excludeReportId ? { reportId: { not: excludeReportId } } : {}),
      },
    },
    _sum: { quantityDone: true },
  })
  for (const r of rows) out.set(r.subActivityId, Number(r._sum.quantityDone ?? 0))
  return out
}

/** Latest cumulative % per lumpsum sub-activity (most recent report by date) over statuses. */
async function latestPercentBySubActivity(
  subActivityIds: string[],
  statuses: ReportStatus[],
  excludeReportId?: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (subActivityIds.length === 0) return out
  const rows = await prisma.reportSubActivity.findMany({
    where: {
      subActivityId: { in: subActivityIds },
      percentComplete: { not: null },
      reportActivity: {
        report: { status: { in: statuses } },
        ...(excludeReportId ? { reportId: { not: excludeReportId } } : {}),
      },
    },
    orderBy: [{ reportActivity: { report: { reportDate: 'desc' } } }, { id: 'desc' }],
    select: { subActivityId: true, percentComplete: true },
  })
  for (const r of rows) {
    if (!out.has(r.subActivityId)) out.set(r.subActivityId, Number(r.percentComplete ?? 0))
  }
  return out
}

// ─── Form scope (assets → activities → sub-activities) ────────────────────────

export interface FormSubActivity {
  id: string
  name: string
  type: 'MEASURED' | 'LUMPSUM'
  isImplicit: boolean
  // measured
  boqQuantity: number // = parent activity BOQ (the per-sub cap)
  committed: number
  earned: number
  remaining: number
  // lumpsum
  lumpsumBhd: number | null
  lastApprovedPercent: number // floor for the % input (no regression)
  // pre-fill from the snapshotted budget (measured only)
  budgetManpower: { categoryId: string; categoryName: string; hoursPerUnit: number }[]
  budgetMaterials: { materialId: string; materialName: string; unit: string; qtyPerUnit: number }[]
}
export interface FormActivity {
  id: string
  ref: string | null
  name: string
  type: 'MEASURED' | 'LUMPSUM'
  unit: string
  subActivities: FormSubActivity[]
}
export interface FormAsset {
  id: string
  ref: string | null
  name: string
  activities: FormActivity[]
}

const scopeSubInclude = {
  where: { isActive: true },
  orderBy: { sortOrder: 'asc' as const },
  include: {
    manpowerBudget: { include: { category: { select: { id: true, name: true } } } },
    materialBudget: { include: { material: { select: { id: true, name: true, unit: true } } } },
  },
}

/**
 * Scope for the report FORM: active assets → active activities → active sub-activities,
 * each with cap/earned/remaining (measured) or lumpsum floor, and budget pre-fill lines.
 * `excludeReportId` removes the report being edited from the committed (cap) figure.
 */
export async function loadFormScope(projectId: string, excludeReportId?: string): Promise<FormAsset[]> {
  const assets = await prisma.asset.findMany({
    where: { projectId, isActive: true, activities: { some: { isActive: true } } },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true, ref: true, name: true,
      activities: {
        where: { isActive: true, subActivities: { some: { isActive: true } } },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, ref: true, name: true, type: true, unit: true, boqQuantity: true, subActivities: scopeSubInclude },
      },
    },
  })

  const allSubs = assets.flatMap((a) => a.activities.flatMap((x) => x.subActivities))
  const measuredIds = allSubs.filter((s) => s.type === 'MEASURED').map((s) => s.id)
  const lumpsumIds = allSubs.filter((s) => s.type === 'LUMPSUM').map((s) => s.id)

  const [committed, earned, floor] = await Promise.all([
    sumBySubActivity(measuredIds, COMMITTED, excludeReportId),
    sumBySubActivity(measuredIds, EARNED),
    latestPercentBySubActivity(lumpsumIds, EARNED),
  ])

  return assets.map((asset) => ({
    id: asset.id, ref: asset.ref, name: asset.name,
    activities: asset.activities.map((act) => {
      const boq = Number(act.boqQuantity)
      return {
        id: act.id, ref: act.ref, name: act.name, type: act.type as 'MEASURED' | 'LUMPSUM', unit: act.unit ?? '',
        subActivities: act.subActivities.map((s) => {
          const committedQ = committed.get(s.id) ?? 0
          return {
            id: s.id, name: s.name, type: s.type as 'MEASURED' | 'LUMPSUM', isImplicit: s.isImplicit,
            boqQuantity: boq,
            committed: committedQ,
            earned: earned.get(s.id) ?? 0,
            remaining: capRemaining(boq, committedQ),
            lumpsumBhd: s.lumpsumBhd == null ? null : Number(s.lumpsumBhd),
            lastApprovedPercent: floor.get(s.id) ?? 0,
            budgetManpower: s.manpowerBudget.map((b) => ({ categoryId: b.category.id, categoryName: b.category.name, hoursPerUnit: Number(b.hoursPerUnit) })),
            budgetMaterials: s.materialBudget.map((b) => ({ materialId: b.material.id, materialName: b.material.name, unit: b.material.unit, qtyPerUnit: Number(b.qtyPerUnit) })),
          }
        }),
      }
    }),
  }))
}

/** Per-sub cap (boq/committed/remaining) for a set of sub-activity ids — for save/submit. */
export async function remainingBySubActivity(
  subActivityIds: string[],
  excludeReportId?: string,
): Promise<Map<string, { boqQuantity: number; committed: number; remaining: number }>> {
  const map = new Map<string, { boqQuantity: number; committed: number; remaining: number }>()
  if (subActivityIds.length === 0) return map
  const [subs, committed] = await Promise.all([
    prisma.subActivity.findMany({
      where: { id: { in: subActivityIds } },
      select: { id: true, type: true, activity: { select: { boqQuantity: true } } },
    }),
    sumBySubActivity(subActivityIds, COMMITTED, excludeReportId),
  ])
  for (const s of subs) {
    const boq = Number(s.activity.boqQuantity)
    const c = committed.get(s.id) ?? 0
    map.set(s.id, { boqQuantity: boq, committed: c, remaining: capRemaining(boq, c) })
  }
  return map
}

/** Latest APPROVED cumulative % per lumpsum sub-activity — the no-regression floor. */
export async function lumpsumFloorBySubActivity(subActivityIds: string[]): Promise<Map<string, number>> {
  return latestPercentBySubActivity(subActivityIds, EARNED)
}

/** Earned (APPROVED-only) measured quantity per sub-activity — for read-view cumulative %. */
export async function earnedBySubActivity(subActivityIds: string[]): Promise<Map<string, number>> {
  return sumBySubActivity(subActivityIds, EARNED)
}

/** Whether a project has at least one active MEASURED activity (mandatory-setup gate). */
export async function projectHasActiveActivities(projectId: string): Promise<boolean> {
  const count = await prisma.activity.count({
    where: { isActive: true, type: 'MEASURED', asset: { projectId, isActive: true } },
  })
  return count > 0
}

// ─── Activity ledger (per-activity progress, sourced from its sub-activities) ──

export interface LedgerEntry {
  reportId: string
  reportCode: string
  date: string
  author: string
  status: ReportStatus
  quantityDone: number
  cumulative: number
}
export interface ActivityLedger {
  activity: { id: string; ref: string | null; name: string; unit: string; assetName: string; projectId: string }
  header: { boqQuantity: number; earned: number; committed: number; percent: number; remaining: number }
  entries: LedgerEntry[]
}

/**
 * Progress ledger for a MEASURED activity, aggregated across its sub-activities: one row
 * per report (SUBMITTED+APPROVED) with the report's total quantityDone for this activity
 * and a running committed cumulative. Header shows earned (APPROVED-only) qty/%/remaining.
 */
export async function activityLedger(activityId: string): Promise<ActivityLedger | null> {
  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    select: { id: true, ref: true, name: true, unit: true, boqQuantity: true, asset: { select: { name: true, projectId: true } } },
  })
  if (!activity) return null

  const rows = await prisma.reportSubActivity.findMany({
    where: { subActivity: { activityId }, quantityDone: { not: null }, reportActivity: { report: { status: { in: COMMITTED } } } },
    orderBy: [{ reportActivity: { report: { reportDate: 'asc' } } }, { reportActivity: { report: { createdAt: 'asc' } } }],
    select: {
      quantityDone: true,
      reportActivity: {
        select: {
          report: {
            select: { id: true, reportCode: true, reportDate: true, status: true, author: { select: { firstName: true, lastName: true } } },
          },
        },
      },
    },
  })

  // Fold sub-activity rows into one entry per report (sum quantityDone for this activity).
  const byReport = new Map<string, LedgerEntry>()
  let running = 0
  let earned = 0
  for (const r of rows) {
    const rep = r.reportActivity.report
    const q = Number(r.quantityDone ?? 0)
    running += q
    if (rep.status === 'APPROVED') earned += q
    const existing = byReport.get(rep.id)
    if (existing) {
      existing.quantityDone += q
      existing.cumulative = running
    } else {
      byReport.set(rep.id, {
        reportId: rep.id, reportCode: rep.reportCode, date: rep.reportDate.toISOString().slice(0, 10),
        author: `${rep.author.firstName} ${rep.author.lastName}`, status: rep.status, quantityDone: q, cumulative: running,
      })
    }
  }

  const boq = Number(activity.boqQuantity)
  return {
    activity: {
      id: activity.id, ref: activity.ref, name: activity.name, unit: activity.unit ?? '',
      assetName: activity.asset.name, projectId: activity.asset.projectId,
    },
    header: { boqQuantity: boq, earned, committed: running, percent: cumulativePercent(earned, boq), remaining: capRemaining(boq, running) },
    entries: [...byReport.values()],
  }
}
