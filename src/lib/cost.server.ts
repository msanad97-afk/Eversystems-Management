import type { ExpenseCategory } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { loadProjectMoney } from '@/lib/money.server'
import { isExpenseEligibleForAC, expenseExclusionReason, round3 } from '@/lib/cost'
import { trafficLight, type Light } from '@/lib/actuals'

/**
 * Phase 6B — Actual Cost and cost performance for a project.
 *
 * AC = field cost (approval-time snapshots on APPROVED reports) + eligible project expenses.
 * Compared against the Phase 6A cost budget (BAC). Two data-quality signals travel with the
 * numbers and are rendered loudly, never buried:
 *   - unpriced: entries approved with no resource rate → real work costed at ZERO, which
 *     would otherwise flatter cost performance.
 *   - approximated: cost filled in by the admin backfill action at today's rates rather
 *     than at approval time — an estimate, and labelled as one everywhere.
 */

export interface UnpricedActual {
  kind: 'LABOUR' | 'MATERIAL'
  resourceName: string
  activityName: string
  reportCode: string
  reportDate: string
}
export interface ExpenseRow {
  id: string
  category: ExpenseCategory
  description: string
  vendor: string | null
  expenseDate: string
  amount: number
  eligible: boolean
  exclusionReason: string | null
}
export interface ActivityCostPerf {
  activityId: string
  ref: string | null
  name: string
  assetName: string
  budgetCost: number
  labourCost: number
  materialCost: number
  actualCost: number
  variance: number
  consumedPct: number | null
  light: Light
  approximated: boolean
  /** Portion of labourCost that is opening-balance direct labour — money with NO man-hours behind it. */
  openingLabourCost: number
}
export interface ProjectCostPerformance {
  projectId: string
  projectName: string
  bac: number
  fieldCost: number
  expenseCost: number
  actualCost: number
  variance: number
  consumedPct: number | null
  light: Light
  approximatedCost: number
  hasApproximations: boolean
  /** Total opening-balance direct labour in AC — money with no man-hours behind it (understates
   *  cumulative man-hours for the project). Surfaced distinctly so it is never read as measured cost. */
  openingLabourCost: number
  hasOpeningLabour: boolean
  unpriced: UnpricedActual[]
  activities: ActivityCostPerf[]
  expenses: { eligible: ExpenseRow[]; excluded: ExpenseRow[]; eligibleTotal: number; excludedTotal: number }
}

export async function loadProjectCostPerformance(projectId: string): Promise<ProjectCostPerformance | null> {
  const money = await loadProjectMoney(projectId)
  if (!money) return null

  // ── field cost: entries on APPROVED reports ──
  const rows = await prisma.reportSubActivity.findMany({
    where: { reportActivity: { report: { projectId, status: 'APPROVED' } } },
    select: {
      subActivity: { select: { activity: { select: { id: true, name: true } } } },
      reportActivity: {
        select: { report: { select: { reportCode: true, reportDate: true, costBackfilledAt: true } } },
      },
      manpower: { select: { costAtApproval: true, category: { select: { name: true } } } },
      materials: { select: { costAtApproval: true, material: { select: { name: true } } } },
    },
  })

  const labourByActivity = new Map<string, number>()
  const materialByActivity = new Map<string, number>()
  const openingByActivity = new Map<string, number>()
  const approxActivities = new Set<string>()
  const unpriced: UnpricedActual[] = []
  let approximatedCost = 0

  for (const r of rows) {
    const act = r.subActivity.activity
    const rep = r.reportActivity.report
    const isApprox = rep.costBackfilledAt != null
    const meta = { activityName: act.name, reportCode: rep.reportCode, reportDate: rep.reportDate.toISOString().slice(0, 10) }

    for (const m of r.manpower) {
      if (m.costAtApproval == null) { unpriced.push({ kind: 'LABOUR', resourceName: m.category.name, ...meta }); continue }
      const c = Number(m.costAtApproval)
      labourByActivity.set(act.id, round3((labourByActivity.get(act.id) ?? 0) + c))
      if (isApprox) { approximatedCost = round3(approximatedCost + c); approxActivities.add(act.id) }
    }
    for (const m of r.materials) {
      if (m.costAtApproval == null) { unpriced.push({ kind: 'MATERIAL', resourceName: m.material.name, ...meta }); continue }
      const c = Number(m.costAtApproval)
      materialByActivity.set(act.id, round3((materialByActivity.get(act.id) ?? 0) + c))
      if (isApprox) { approximatedCost = round3(approximatedCost + c); approxActivities.add(act.id) }
    }
  }

  // ── opening-balance direct labour: activity-level cost with no hours, part of AC but tracked
  //    separately so it is surfaced distinctly. Read as any labour cost — never as an opening flag. ──
  const openingRows = await prisma.reportActivity.findMany({
    where: { openingLabourCost: { not: null }, report: { projectId, status: 'APPROVED' } },
    select: { activityId: true, openingLabourCost: true },
  })
  for (const o of openingRows) {
    const c = Number(o.openingLabourCost)
    labourByActivity.set(o.activityId, round3((labourByActivity.get(o.activityId) ?? 0) + c))
    openingByActivity.set(o.activityId, round3((openingByActivity.get(o.activityId) ?? 0) + c))
  }

  // ── expenses ──
  const expenseRows = await prisma.expense.findMany({
    where: { projectId },
    orderBy: [{ expenseDate: 'desc' }],
    select: { id: true, category: true, description: true, vendor: true, expenseDate: true, amount: true, projectId: true },
  })
  const expenses = expenseRows.map((e) => ({
    id: e.id,
    category: e.category,
    description: e.description,
    vendor: e.vendor,
    expenseDate: e.expenseDate.toISOString().slice(0, 10),
    amount: Number(e.amount),
    eligible: isExpenseEligibleForAC(e.category, e.projectId),
    exclusionReason: expenseExclusionReason(e.category, e.projectId),
  }))
  const eligible = expenses.filter((e) => e.eligible)
  const excluded = expenses.filter((e) => !e.eligible)
  const eligibleTotal = round3(eligible.reduce((s, e) => s + e.amount, 0))
  const excludedTotal = round3(excluded.reduce((s, e) => s + e.amount, 0))

  // ── per-activity performance (field cost only — expenses have no activity link) ──
  const budgetByActivity = new Map<string, { budget: number; ref: string | null; name: string; assetName: string }>()
  for (const asset of money.assets) {
    for (const a of asset.activities) {
      budgetByActivity.set(a.activityId, { budget: a.costBudget, ref: a.ref, name: a.name, assetName: asset.assetName })
    }
  }
  const activityIds = new Set<string>([...budgetByActivity.keys(), ...labourByActivity.keys(), ...materialByActivity.keys()])
  const activities: ActivityCostPerf[] = [...activityIds].map((id) => {
    const b = budgetByActivity.get(id)
    const labourCost = labourByActivity.get(id) ?? 0
    const materialCost = materialByActivity.get(id) ?? 0
    const actualCost = round3(labourCost + materialCost)
    const budgetCost = b?.budget ?? 0
    return {
      activityId: id,
      ref: b?.ref ?? null,
      name: b?.name ?? '(removed activity)',
      assetName: b?.assetName ?? '',
      budgetCost,
      labourCost,
      materialCost,
      actualCost,
      variance: round3(budgetCost - actualCost),
      consumedPct: budgetCost > 0 ? Math.round((actualCost / budgetCost) * 1000) / 10 : null,
      light: trafficLight(actualCost, budgetCost),
      approximated: approxActivities.has(id),
      openingLabourCost: openingByActivity.get(id) ?? 0,
    }
  }).sort((a, b) => a.assetName.localeCompare(b.assetName) || a.name.localeCompare(b.name))

  const openingLabourCost = round3([...openingByActivity.values()].reduce((s, v) => s + v, 0))

  const fieldCost = round3([...labourByActivity.values()].reduce((s, v) => s + v, 0) + [...materialByActivity.values()].reduce((s, v) => s + v, 0))
  const actualCost = round3(fieldCost + eligibleTotal)

  return {
    projectId: money.projectId,
    projectName: money.projectName,
    bac: money.bac,
    fieldCost,
    expenseCost: eligibleTotal,
    actualCost,
    variance: round3(money.bac - actualCost),
    consumedPct: money.bac > 0 ? Math.round((actualCost / money.bac) * 1000) / 10 : null,
    light: trafficLight(actualCost, money.bac),
    approximatedCost,
    hasApproximations: approximatedCost > 0,
    openingLabourCost,
    hasOpeningLabour: openingLabourCost > 0,
    unpriced,
    activities,
    expenses: { eligible, excluded, eligibleTotal, excludedTotal },
  }
}
