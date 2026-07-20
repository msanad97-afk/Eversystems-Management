import type { Prisma, PrismaClient } from '@prisma/client'

type Tx = Prisma.TransactionClient | PrismaClient

/**
 * Phase 6B — the ACTUAL-COST snapshot, written once when a report is APPROVED.
 *
 * Each entry is costed at the resource's LIVE global rate at that moment:
 *   manpower: cost = headcount × hours × LaborCategory.hourlyRate
 *   material: cost = quantity × Material.unitRate
 *
 * This is deliberately asymmetric to the BUDGET, which uses the rates frozen when the
 * activity was placed (Phase 6A): a plan is priced when you plan it, a cost is what it
 * cost when the work happened. Re-pricing a budget therefore never moves actuals.
 *
 * Unpriced resources (no rate) are left NULL — they contribute 0 to Actual Cost and are
 * surfaced loudly, rather than silently costing real work at zero. Approval is never
 * blocked. Writes only where costAtApproval IS NULL, so it is idempotent and can never
 * overwrite a real approval-time cost with a later (backfilled) one.
 */

export interface CostSnapshotResult {
  pricedManpower: number
  unpricedManpower: number
  pricedMaterial: number
  unpricedMaterial: number
  totalCost: number
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

export async function snapshotReportCosts(tx: Tx, reportId: string): Promise<CostSnapshotResult> {
  const report = await tx.dailyReport.findUnique({
    where: { id: reportId },
    select: {
      activities: {
        select: {
          subActivities: {
            select: {
              manpower: {
                select: { id: true, headcount: true, hours: true, costAtApproval: true, category: { select: { hourlyRate: true } } },
              },
              materials: {
                select: { id: true, quantity: true, costAtApproval: true, material: { select: { unitRate: true } } },
              },
            },
          },
        },
      },
    },
  })

  const result: CostSnapshotResult = { pricedManpower: 0, unpricedManpower: 0, pricedMaterial: 0, unpricedMaterial: 0, totalCost: 0 }
  if (!report) return result

  for (const a of report.activities) {
    for (const s of a.subActivities) {
      for (const m of s.manpower) {
        if (m.costAtApproval != null) continue // already snapshotted — never overwrite
        if (m.category.hourlyRate == null) { result.unpricedManpower++; continue }
        const rate = Number(m.category.hourlyRate)
        const cost = round3(m.headcount * Number(m.hours) * rate)
        await tx.manpowerEntry.update({ where: { id: m.id }, data: { rateAtApproval: rate, costAtApproval: cost } })
        result.pricedManpower++
        result.totalCost = round3(result.totalCost + cost)
      }
      for (const m of s.materials) {
        if (m.costAtApproval != null) continue
        if (m.material.unitRate == null) { result.unpricedMaterial++; continue }
        const rate = Number(m.material.unitRate)
        const cost = round3(Number(m.quantity) * rate)
        await tx.materialEntry.update({ where: { id: m.id }, data: { rateAtApproval: rate, costAtApproval: cost } })
        result.pricedMaterial++
        result.totalCost = round3(result.totalCost + cost)
      }
    }
  }
  return result
}
