import { prisma } from '@/lib/prisma'
import {
  deriveActivityBudget,
  deriveProjectBudget,
  type ActivityInput,
  type ActivityBudget,
  type ProjectBudget,
} from '@/lib/budget'

const activityInclude = {
  subActivities: {
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' as const },
    include: {
      manpowerBudget: { include: { category: { select: { id: true, name: true } } } },
      materialBudget: { include: { material: { select: { id: true, name: true, unit: true } } } },
    },
  },
}

type LoadedActivity = {
  id: string
  ref: string | null
  name: string
  type: 'MEASURED' | 'LUMPSUM'
  unit: string | null
  boqQuantity: unknown
  lumpsumBhd: unknown
  subActivities: {
    id: string
    name: string
    type: 'MEASURED' | 'LUMPSUM'
    isImplicit: boolean
    lumpsumBhd: unknown
    manpowerBudget: { hoursPerUnit: unknown; category: { id: string; name: string } }[]
    materialBudget: { qtyPerUnit: unknown; material: { id: string; name: string; unit: string } }[]
  }[]
}

function toInput(a: LoadedActivity): ActivityInput {
  return {
    id: a.id,
    ref: a.ref,
    name: a.name,
    type: a.type,
    unit: a.unit,
    boqQuantity: Number(a.boqQuantity),
    lumpsumBhd: a.lumpsumBhd == null ? null : Number(a.lumpsumBhd),
    subActivities: a.subActivities.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      isImplicit: s.isImplicit,
      lumpsumBhd: s.lumpsumBhd == null ? null : Number(s.lumpsumBhd),
      manpower: s.manpowerBudget.map((r) => ({
        laborCategoryId: r.category.id,
        laborCategoryName: r.category.name,
        hoursPerUnit: Number(r.hoursPerUnit),
      })),
      materials: s.materialBudget.map((r) => ({
        materialId: r.material.id,
        materialName: r.material.name,
        materialUnit: r.material.unit,
        qtyPerUnit: Number(r.qtyPerUnit),
      })),
    })),
  }
}

/** Derived budget for a single activity (measured hours/qty + lumpsum BHD). */
export async function loadActivityBudget(activityId: string): Promise<ActivityBudget | null> {
  const a = await prisma.activity.findUnique({ where: { id: activityId }, include: activityInclude })
  if (!a) return null
  return deriveActivityBudget(toInput(a as unknown as LoadedActivity))
}

/** Derived budget rollup for a whole project — active assets/activities only. */
export async function loadProjectBudget(projectId: string): Promise<ProjectBudget | null> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true } })
  if (!project) return null

  const assets = await prisma.asset.findMany({
    where: { projectId, isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      name: true,
      activities: {
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        include: activityInclude,
      },
    },
  })

  return deriveProjectBudget(
    project.id,
    project.name,
    assets.map((asset) => ({
      assetId: asset.id,
      assetName: asset.name,
      activities: asset.activities.map((a) => toInput(a as unknown as LoadedActivity)),
    })),
  )
}
