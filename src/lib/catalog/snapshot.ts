import type { Prisma, PrismaClient } from '@prisma/client'
import { implicitSubActivityCreate } from './implicitSub'

type Tx = Prisma.TransactionClient | PrismaClient

/**
 * Deep-copy a catalog activity onto an asset as project-owned rows, inside the caller's
 * transaction. Every rate/lumpsum is copied as a scalar into SubActivity*Budget /
 * Activity.lumpsumBhd — NO foreign key points back to the catalog, so later editing or
 * deleting the template cannot change this placement's budget. `catalogActivityId` is
 * stored only as provenance (SetNull on delete) and is never read to derive a budget.
 *
 * MEASURED activity: `boqQuantity` (the CAP) is required, and an optional `billRate` (the
 * contract value per unit) may be captured at placement so the line carries its revenue
 * immediately. LUMPSUM activity: boqQuantity is forced to 0 and `lumpsumOverrideBhd` (or the
 * template default) is frozen on the row as a COST — lumpsums never carry contract value.
 */
export async function snapshotCatalogActivity(
  tx: Tx,
  catalogActivityId: string,
  opts: {
    assetId: string
    sortOrder: number
    boqQuantity?: number
    ref?: string | null
    lumpsumOverrideBhd?: number | null
    billRate?: number | null
  },
): Promise<{ id: string }> {
  const template = await tx.catalogActivity.findUnique({
    where: { id: catalogActivityId },
    include: {
      subActivities: {
        orderBy: { sortOrder: 'asc' },
        include: {
          // Phase 6A: pull each resource's CURRENT global cost rate so it can be frozen
          // onto the placed budget row (see costRateAtPlacement).
          manpowerRates: { select: { laborCategoryId: true, hoursPerUnit: true, category: { select: { hourlyRate: true } } } },
          materialRates: { select: { materialId: true, qtyPerUnit: true, material: { select: { unitRate: true } } } },
        },
      },
    },
  })
  if (!template) throw new Error('Catalog activity not found.')

  const isLumpsum = template.type === 'LUMPSUM'
  const lumpsumBhd = isLumpsum
    ? (opts.lumpsumOverrideBhd ?? (template.lumpsumBhd ? Number(template.lumpsumBhd) : null))
    : null

  const copiedSubs = template.subActivities.map((s) => ({
    name: s.name,
    type: s.type,
    lumpsumBhd: s.lumpsumBhd ? Number(s.lumpsumBhd) : null,
    sortOrder: s.sortOrder,
    isImplicit: s.isImplicit,
    manpowerBudget: {
      create: s.manpowerRates.map((r) => ({
        laborCategoryId: r.laborCategoryId,
        hoursPerUnit: Number(r.hoursPerUnit),
        costRateAtPlacement: r.category.hourlyRate == null ? null : Number(r.category.hourlyRate),
      })),
    },
    materialBudget: {
      create: s.materialRates.map((r) => ({
        materialId: r.materialId,
        qtyPerUnit: Number(r.qtyPerUnit),
        costRateAtPlacement: r.material.unitRate == null ? null : Number(r.material.unitRate),
      })),
    },
  }))

  // Every reportable activity needs at least one sub-activity — add the implicit one when
  // the template has no named sub-activities (a bare measured line or a pure lumpsum).
  const subCreate = copiedSubs.length > 0 ? copiedSubs : [implicitSubActivityCreate(template.type, lumpsumBhd)]

  const created = await tx.activity.create({
    data: {
      assetId: opts.assetId,
      catalogActivityId: template.id,
      name: template.name,
      ref: opts.ref ?? null,
      type: template.type,
      unit: isLumpsum ? null : template.unit,
      boqQuantity: isLumpsum ? 0 : (opts.boqQuantity ?? 0),
      lumpsumBhd,
      // Revenue is measured-only, so a bill rate is meaningless on a lumpsum placement.
      billRate: isLumpsum ? null : (opts.billRate ?? null),
      pricedAt: new Date(), // cost rates frozen as of now
      sortOrder: opts.sortOrder,
      subActivities: { create: subCreate },
    },
    select: { id: true },
  })
  return created
}
