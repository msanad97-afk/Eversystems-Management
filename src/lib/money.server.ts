import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { deriveProjectMoney, type MoneyActivity, type ProjectMoney } from '@/lib/money'

type Tx = Prisma.TransactionClient | PrismaClient

export interface RateChange {
  kind: 'LABOUR' | 'MATERIAL'
  resourceName: string
  from: number | null
  to: number | null
}

/**
 * Deliberately re-snapshot the CURRENT global cost rates onto an activity's frozen budget
 * rows. This is the only thing that may move a placed cost baseline — placement freezes the
 * rates, and editing a global catalog rate never reaches here. Returns the old→new changes
 * so the caller can audit them (allowed even when approved reports exist, but it shifts the
 * budget baseline and therefore variance/CPI — the UI warns before calling).
 */
export async function repriceActivity(tx: Tx, activityId: string): Promise<RateChange[]> {
  const activity = await tx.activity.findUnique({
    where: { id: activityId },
    select: {
      id: true,
      subActivities: {
        select: {
          manpowerBudget: { select: { id: true, costRateAtPlacement: true, category: { select: { name: true, hourlyRate: true } } } },
          materialBudget: { select: { id: true, costRateAtPlacement: true, material: { select: { name: true, unitRate: true } } } },
        },
      },
    },
  })
  if (!activity) return []

  const changes: RateChange[] = []
  for (const s of activity.subActivities) {
    for (const b of s.manpowerBudget) {
      const from = b.costRateAtPlacement == null ? null : Number(b.costRateAtPlacement)
      const to = b.category.hourlyRate == null ? null : Number(b.category.hourlyRate)
      if (from !== to) {
        await tx.subActivityManpowerBudget.update({ where: { id: b.id }, data: { costRateAtPlacement: to } })
        changes.push({ kind: 'LABOUR', resourceName: b.category.name, from, to })
      }
    }
    for (const b of s.materialBudget) {
      const from = b.costRateAtPlacement == null ? null : Number(b.costRateAtPlacement)
      const to = b.material.unitRate == null ? null : Number(b.material.unitRate)
      if (from !== to) {
        await tx.subActivityMaterialBudget.update({ where: { id: b.id }, data: { costRateAtPlacement: to } })
        changes.push({ kind: 'MATERIAL', resourceName: b.material.name, from, to })
      }
    }
  }
  await tx.activity.update({ where: { id: activityId }, data: { pricedAt: new Date() } })
  return changes
}

const activitySelect = {
  id: true, ref: true, name: true, type: true, unit: true, boqQuantity: true,
  lumpsumBhd: true, costRate: true, billRate: true, pricedAt: true,
  subActivities: {
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' as const },
    select: {
      id: true, name: true, type: true, lumpsumBhd: true,
      manpowerBudget: { select: { hoursPerUnit: true, costRateAtPlacement: true, category: { select: { id: true, name: true } } } },
      materialBudget: { select: { qtyPerUnit: true, costRateAtPlacement: true, material: { select: { id: true, name: true, unit: true } } } },
    },
  },
} as const

type Loaded = {
  id: string
  ref: string | null
  name: string
  type: 'MEASURED' | 'LUMPSUM'
  unit: string | null
  boqQuantity: unknown
  lumpsumBhd: unknown
  costRate: unknown
  billRate: unknown
  subActivities: {
    id: string
    name: string
    type: 'MEASURED' | 'LUMPSUM'
    lumpsumBhd: unknown
    manpowerBudget: { hoursPerUnit: unknown; costRateAtPlacement: unknown; category: { id: string; name: string } }[]
    materialBudget: { qtyPerUnit: unknown; costRateAtPlacement: unknown; material: { id: string; name: string; unit: string } }[]
  }[]
}

const n = (v: unknown): number | null => (v == null ? null : Number(v))

function toInput(a: Loaded): MoneyActivity {
  return {
    id: a.id, ref: a.ref, name: a.name, type: a.type, unit: a.unit,
    boqQuantity: Number(a.boqQuantity),
    lumpsumBhd: n(a.lumpsumBhd),
    costRate: n(a.costRate),
    billRate: n(a.billRate),
    subActivities: a.subActivities.map((s) => ({
      id: s.id, name: s.name, type: s.type,
      lumpsumBhd: n(s.lumpsumBhd),
      manpower: s.manpowerBudget.map((b) => ({
        laborCategoryId: b.category.id,
        laborCategoryName: b.category.name,
        hoursPerUnit: Number(b.hoursPerUnit),
        costRateAtPlacement: n(b.costRateAtPlacement),
      })),
      materials: s.materialBudget.map((b) => ({
        materialId: b.material.id,
        materialName: b.material.name,
        materialUnit: b.material.unit,
        qtyPerUnit: Number(b.qtyPerUnit),
        costRateAtPlacement: n(b.costRateAtPlacement),
      })),
    })),
  }
}

/**
 * Cost budget (BAC), contract value and margin for a project — priced from the cost rates
 * FROZEN on each budget row at placement, so live catalog-rate edits never move it.
 */
export async function loadProjectMoney(projectId: string): Promise<ProjectMoney | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, budgetCost: true, contractValue: true },
  })
  if (!project) return null

  const assets = await prisma.asset.findMany({
    where: { projectId, isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true, name: true, lumpsumRevenue: true,
      activities: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: activitySelect },
    },
  })

  return deriveProjectMoney(
    project.id,
    project.name,
    assets.map((asset) => ({
      assetId: asset.id,
      assetName: asset.name,
      lumpsumRevenue: n(asset.lumpsumRevenue),
      activities: asset.activities.map((a) => toInput(a as unknown as Loaded)),
    })),
    { budgetCost: n(project.budgetCost), contractValue: n(project.contractValue) },
  )
}
