import { prisma } from '@/lib/prisma'

/**
 * ADMIN-ONLY cost projection for material requests. This is the ONLY module in the feature
 * that reads Material.unitRate. It must never be imported by a supervisor-facing route or
 * page — the money wall depends on cost staying on this side of the seam. Cost = qty × the
 * global Material.unitRate (the app's established cost basis; null rate = unpriced).
 */

export interface MaterialCostRate {
  materialId: string
  unitRate: number | null // null = unpriced material
}

/** Global cost rate per material (BHD/unit). ADMIN callers only. */
export async function loadMaterialCostRates(materialIds: string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>()
  if (materialIds.length === 0) return out
  const rows = await prisma.material.findMany({
    where: { id: { in: materialIds } },
    select: { id: true, unitRate: true },
  })
  for (const r of rows) out.set(r.id, r.unitRate == null ? null : Number(r.unitRate))
  return out
}

/** Line cost = qty × rate, or null when the material is unpriced. */
export function lineCost(qty: number, rate: number | null): number | null {
  return rate == null ? null : Math.round(qty * rate * 1000) / 1000
}
