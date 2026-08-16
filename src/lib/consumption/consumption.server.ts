import type { Prisma } from '@prisma/client'
import { deriveSubConsumption, type BudgetRate, type MaterialEntryInput } from '@/lib/consumption/derive'

/**
 * On report submit: record derived material consumption for every reported measured sub-activity.
 * Runs inside the submit transaction.
 *
 * Idempotent by dailyReportId (same pattern as the MISSING_ATTACHMENT alert): if entries already
 * exist for the report, do nothing — re-submission never duplicates.
 *
 * A reported sub-activity with NO material budget rate derives nothing (does not fail) and raises
 * one MISSING_CONSUMPTION_RATE alert per sub-activity per report, idempotent by sourceRecordId
 * (the ReportSubActivity id), so management sees consumption was not tracked for that work.
 *
 * Money wall: the budget select takes qtyPerUnit + material unit ONLY — never costRateAtPlacement
 * or any price — even though the rate lives on a row that also carries cost.
 */
export async function recordConsumptionOnSubmit(
  tx: Prisma.TransactionClient,
  reportId: string,
  projectId: string,
): Promise<{ entries: number; missingRateAlerts: number }> {
  const already = await tx.consumptionEntry.count({ where: { dailyReportId: reportId } })
  if (already > 0) return { entries: 0, missingRateAlerts: 0 }

  const reportSubs = await tx.reportSubActivity.findMany({
    where: { reportActivity: { reportId }, quantityDone: { not: null } },
    select: {
      id: true,
      subActivityId: true,
      quantityDone: true,
      subActivity: { select: { type: true } },
      materials: { select: { materialId: true, quantity: true, quantityTouched: true, material: { select: { unit: true } } } },
    },
  })
  const measured = reportSubs.filter((rs) => rs.subActivity.type === 'MEASURED' && Number(rs.quantityDone) > 0)
  if (measured.length === 0) return { entries: 0, missingRateAlerts: 0 }

  // Budget rates for those sub-activities — QUANTITIES ONLY (qtyPerUnit + material unit).
  const budgets = await tx.subActivityMaterialBudget.findMany({
    where: { subActivityId: { in: measured.map((m) => m.subActivityId) } },
    select: { subActivityId: true, materialId: true, qtyPerUnit: true, material: { select: { unit: true } } },
  })
  const budgetBySub = new Map<string, BudgetRate[]>()
  for (const b of budgets) {
    const list = budgetBySub.get(b.subActivityId) ?? []
    list.push({ materialId: b.materialId, unit: b.material.unit, estimateRate: Number(b.qtyPerUnit) })
    budgetBySub.set(b.subActivityId, list)
  }

  const entryData: Prisma.ConsumptionEntryCreateManyInput[] = []
  const missingRateSubReportIds: string[] = []

  for (const rs of measured) {
    const budget = budgetBySub.get(rs.subActivityId) ?? []
    if (budget.length === 0) {
      missingRateSubReportIds.push(rs.id) // no rate → derive nothing, flag it
      continue
    }
    const entries: MaterialEntryInput[] = rs.materials.map((m) => ({ materialId: m.materialId, unit: m.material.unit, quantity: Number(m.quantity), touched: m.quantityTouched === true }))
    for (const d of deriveSubConsumption(Number(rs.quantityDone), budget, entries)) {
      entryData.push({
        dailyReportId: reportId,
        projectId,
        materialId: d.materialId,
        quantity: d.quantity,
        unit: d.unit,
        source: d.source,
        estimateRate: d.estimateRate,
        subActivityReportId: rs.id,
      })
    }
  }

  if (entryData.length > 0) await tx.consumptionEntry.createMany({ data: entryData })

  let missingRateAlerts = 0
  if (missingRateSubReportIds.length > 0) {
    const existing = await tx.inventoryAlert.findMany({
      where: { type: 'MISSING_CONSUMPTION_RATE', sourceRecordId: { in: missingRateSubReportIds } },
      select: { sourceRecordId: true },
    })
    const have = new Set(existing.map((e) => e.sourceRecordId))
    const toCreate = missingRateSubReportIds.filter((id) => !have.has(id))
    if (toCreate.length > 0) {
      await tx.inventoryAlert.createMany({
        data: toCreate.map((id) => ({ projectId, type: 'MISSING_CONSUMPTION_RATE' as const, sourceRecordId: id, status: 'OPEN' as const })),
      })
      missingRateAlerts = toCreate.length
    }
  }

  return { entries: entryData.length, missingRateAlerts }
}
