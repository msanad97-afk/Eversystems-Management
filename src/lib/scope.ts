/**
 * Shared serialization for a project-scope Activity row (used by the scope API and the
 * project detail page). Rev 2: an activity is MEASURED (unit + boqQuantity) or LUMPSUM
 * (lumpsumBhd, no unit); `fromCatalog` and `subActivityCount` drive the scope UI.
 */

export const scopeActivitySelect = {
  id: true,
  ref: true,
  name: true,
  type: true,
  unit: true,
  boqQuantity: true,
  lumpsumBhd: true,
  isActive: true,
  sortOrder: true,
  catalogActivityId: true,
  _count: { select: { subActivities: true } },
} as const

export type ScopeActivityRow = {
  id: string
  ref: string | null
  name: string
  type: 'MEASURED' | 'LUMPSUM'
  unit: string | null
  boqQuantity: unknown
  lumpsumBhd: unknown
  isActive: boolean
  sortOrder: number
  catalogActivityId: string | null
  _count: { subActivities: number }
}

export interface SerializedScopeActivity {
  id: string
  ref: string | null
  name: string
  type: 'MEASURED' | 'LUMPSUM'
  unit: string | null
  boqQuantity: number
  lumpsumBhd: number | null
  isActive: boolean
  sortOrder: number
  fromCatalog: boolean
  subActivityCount: number
}

export function serializeScopeActivity(a: ScopeActivityRow): SerializedScopeActivity {
  return {
    id: a.id,
    ref: a.ref,
    name: a.name,
    type: a.type,
    unit: a.unit,
    boqQuantity: Number(a.boqQuantity),
    lumpsumBhd: a.lumpsumBhd == null ? null : Number(a.lumpsumBhd),
    isActive: a.isActive,
    sortOrder: a.sortOrder,
    fromCatalog: a.catalogActivityId != null,
    subActivityCount: a._count.subActivities,
  }
}
