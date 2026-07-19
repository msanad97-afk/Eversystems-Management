import type { Prisma, PrismaClient } from '@prisma/client'

type Tx = Prisma.TransactionClient | PrismaClient

/**
 * Deep-copy a catalog activity onto an asset as project-owned rows, inside the caller's
 * transaction. Every rate/lumpsum is copied as a scalar into SubActivity*Budget /
 * Activity.lumpsumBhd — NO foreign key points back to the catalog, so later editing or
 * deleting the template cannot change this placement's budget. `catalogActivityId` is
 * stored only as provenance (SetNull on delete) and is never read to derive a budget.
 *
 * MEASURED activity: `boqQuantity` (the CAP) is required. LUMPSUM activity: boqQuantity
 * is forced to 0 and `lumpsumOverrideBhd` (or the template default) is frozen on the row.
 */
export async function snapshotCatalogActivity(
  tx: Tx,
  catalogActivityId: string,
  opts: { assetId: string; sortOrder: number; boqQuantity?: number; ref?: string | null; lumpsumOverrideBhd?: number | null },
): Promise<{ id: string }> {
  const template = await tx.catalogActivity.findUnique({
    where: { id: catalogActivityId },
    include: {
      subActivities: {
        orderBy: { sortOrder: 'asc' },
        include: {
          manpowerRates: { select: { laborCategoryId: true, hoursPerUnit: true } },
          materialRates: { select: { materialId: true, qtyPerUnit: true } },
        },
      },
    },
  })
  if (!template) throw new Error('Catalog activity not found.')

  const isLumpsum = template.type === 'LUMPSUM'
  const lumpsumBhd = isLumpsum
    ? (opts.lumpsumOverrideBhd ?? (template.lumpsumBhd ? Number(template.lumpsumBhd) : null))
    : null

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
      sortOrder: opts.sortOrder,
      subActivities: {
        create: template.subActivities.map((s) => ({
          name: s.name,
          type: s.type,
          lumpsumBhd: s.lumpsumBhd ? Number(s.lumpsumBhd) : null,
          sortOrder: s.sortOrder,
          isImplicit: s.isImplicit,
          manpowerBudget: {
            create: s.manpowerRates.map((r) => ({
              laborCategoryId: r.laborCategoryId,
              hoursPerUnit: Number(r.hoursPerUnit),
            })),
          },
          materialBudget: {
            create: s.materialRates.map((r) => ({
              materialId: r.materialId,
              qtyPerUnit: Number(r.qtyPerUnit),
            })),
          },
        })),
      },
    },
    select: { id: true },
  })
  return created
}
