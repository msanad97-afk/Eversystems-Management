import type { Prisma } from '@prisma/client'
import { isNonEmptyString } from '@/lib/validation'
import { IMPLICIT_SUBACTIVITY_NAME } from './constants'

/**
 * Parsing + (de)serialization for a catalog activity's full definition. A catalog
 * activity is edited as a whole (create/replace) — its sub-activities and rate lines
 * travel in the same payload — so POST and PATCH share this one parser.
 */

export type LineType = 'MEASURED' | 'LUMPSUM'

function parsePositive(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

export interface ParsedSub {
  name: string
  type: LineType
  lumpsumBhd: number | null
  isImplicit: boolean
  manpowerRates: { laborCategoryId: string; hoursPerUnit: number }[]
  materialRates: { materialId: string; qtyPerUnit: number }[]
}

export interface ParsedCatalogActivity {
  name: string
  type: LineType
  unit: string | null
  lumpsumBhd: number | null
  description: string | null
  subActivities: ParsedSub[]
}

function parseRates(raw: unknown): { manpowerRates: ParsedSub['manpowerRates']; materialRates: ParsedSub['materialRates'] } | { error: string } {
  const rec = isRecord(raw) ? raw : {}
  const manpowerRates: ParsedSub['manpowerRates'] = []
  const materialRates: ParsedSub['materialRates'] = []
  const seenLabor = new Set<string>()
  const seenMat = new Set<string>()

  const mp = Array.isArray(rec.manpowerRates) ? rec.manpowerRates : []
  for (const r of mp) {
    if (!isRecord(r) || !isNonEmptyString(r.laborCategoryId)) return { error: 'Each manpower rate needs a labour category.' }
    const hpu = parsePositive(r.hoursPerUnit)
    if (hpu === null) return { error: 'Each manpower rate needs hours/unit greater than 0.' }
    if (seenLabor.has(r.laborCategoryId)) return { error: 'A labour category is listed twice in one line.' }
    seenLabor.add(r.laborCategoryId)
    manpowerRates.push({ laborCategoryId: r.laborCategoryId, hoursPerUnit: hpu })
  }
  const mt = Array.isArray(rec.materialRates) ? rec.materialRates : []
  for (const r of mt) {
    if (!isRecord(r) || !isNonEmptyString(r.materialId)) return { error: 'Each material rate needs a material.' }
    const qpu = parsePositive(r.qtyPerUnit)
    if (qpu === null) return { error: 'Each material rate needs qty/unit greater than 0.' }
    if (seenMat.has(r.materialId)) return { error: 'A material is listed twice in one line.' }
    seenMat.add(r.materialId)
    materialRates.push({ materialId: r.materialId, qtyPerUnit: qpu })
  }
  return { manpowerRates, materialRates }
}

/** Parse the whole catalog-activity payload. Returns a normalized definition or an error. */
export function parseCatalogActivity(body: unknown): ParsedCatalogActivity | { error: string } {
  const b = isRecord(body) ? body : {}
  const name = isNonEmptyString(b.name) ? b.name.trim() : null
  if (!name) return { error: 'Activity name is required.' }
  const type: LineType = b.type === 'LUMPSUM' ? 'LUMPSUM' : 'MEASURED'
  const description = isNonEmptyString(b.description) ? b.description.trim() : null

  if (type === 'LUMPSUM') {
    const lumpsumBhd = parsePositive(b.lumpsumBhd)
    if (lumpsumBhd === null) return { error: 'A lumpsum activity needs a BHD amount greater than 0.' }
    return { name, type, unit: null, lumpsumBhd, description, subActivities: [] }
  }

  // MEASURED
  const unit = isNonEmptyString(b.unit) ? b.unit.trim() : null
  if (!unit) return { error: 'A measured activity needs a unit.' }

  const rawSubs = Array.isArray(b.subActivities) ? b.subActivities : []
  const subActivities: ParsedSub[] = []

  if (rawSubs.length > 0) {
    const seenNames = new Set<string>()
    for (const s of rawSubs) {
      if (!isRecord(s)) return { error: 'Invalid sub-activity.' }
      const sName = isNonEmptyString(s.name) ? s.name.trim() : null
      if (!sName) return { error: 'Each sub-activity needs a name.' }
      if (sName === IMPLICIT_SUBACTIVITY_NAME) return { error: 'That sub-activity name is reserved.' }
      const key = sName.toLowerCase()
      if (seenNames.has(key)) return { error: `Duplicate sub-activity name "${sName}".` }
      seenNames.add(key)
      const sType: LineType = s.type === 'LUMPSUM' ? 'LUMPSUM' : 'MEASURED'
      if (sType === 'LUMPSUM') {
        const sLump = parsePositive(s.lumpsumBhd)
        if (sLump === null) return { error: `Lumpsum sub-activity "${sName}" needs a BHD amount greater than 0.` }
        subActivities.push({ name: sName, type: 'LUMPSUM', lumpsumBhd: sLump, isImplicit: false, manpowerRates: [], materialRates: [] })
      } else {
        const rates = parseRates(s)
        if ('error' in rates) return { error: `Sub-activity "${sName}": ${rates.error}` }
        subActivities.push({ name: sName, type: 'MEASURED', lumpsumBhd: null, isImplicit: false, ...rates })
      }
    }
  } else {
    // Flat measured activity: any rates provided attach to a single hidden implicit sub-activity.
    const rates = parseRates(b.activityRates)
    if ('error' in rates) return { error: rates.error }
    if (rates.manpowerRates.length > 0 || rates.materialRates.length > 0) {
      subActivities.push({ name: IMPLICIT_SUBACTIVITY_NAME, type: 'MEASURED', lumpsumBhd: null, isImplicit: true, ...rates })
    }
    // else: bare measured activity with no budget (allowed).
  }

  return { name, type, unit, lumpsumBhd: null, description, subActivities }
}

/** Prisma nested-create input for a parsed definition's sub-activities. */
export function subActivityCreateInput(subs: ParsedSub[]): Prisma.CatalogSubActivityCreateWithoutCatalogActivityInput[] {
  return subs.map((s, i) => ({
    name: s.name,
    type: s.type,
    lumpsumBhd: s.lumpsumBhd,
    sortOrder: i,
    isImplicit: s.isImplicit,
    manpowerRates: { create: s.manpowerRates.map((r) => ({ laborCategoryId: r.laborCategoryId, hoursPerUnit: r.hoursPerUnit })) },
    materialRates: { create: s.materialRates.map((r) => ({ materialId: r.materialId, qtyPerUnit: r.qtyPerUnit })) },
  }))
}

// ─── Serialization for the client ────────────────────────────────────────────

export const catalogActivitySelect = {
  id: true,
  name: true,
  type: true,
  unit: true,
  lumpsumBhd: true,
  description: true,
  isActive: true,
  sortOrder: true,
  subActivities: {
    orderBy: { sortOrder: 'asc' as const },
    select: {
      id: true,
      name: true,
      type: true,
      lumpsumBhd: true,
      isImplicit: true,
      sortOrder: true,
      manpowerRates: { select: { laborCategoryId: true, hoursPerUnit: true, category: { select: { name: true } } } },
      materialRates: { select: { materialId: true, qtyPerUnit: true, material: { select: { name: true, unit: true } } } },
    },
  },
} as const

type SerializableCatalogActivity = {
  id: string
  name: string
  type: LineType
  unit: string | null
  lumpsumBhd: unknown
  description: string | null
  isActive: boolean
  sortOrder: number
  subActivities: {
    id: string
    name: string
    type: LineType
    lumpsumBhd: unknown
    isImplicit: boolean
    sortOrder: number
    manpowerRates: { laborCategoryId: string; hoursPerUnit: unknown; category: { name: string } }[]
    materialRates: { materialId: string; qtyPerUnit: unknown; material: { name: string; unit: string } }[]
  }[]
}

export interface CatalogActivityDTO {
  id: string
  name: string
  type: LineType
  unit: string | null
  lumpsumBhd: number | null
  description: string | null
  isActive: boolean
  sortOrder: number
  subActivities: {
    id: string
    name: string
    type: LineType
    lumpsumBhd: number | null
    isImplicit: boolean
    manpowerRates: { laborCategoryId: string; laborCategoryName: string; hoursPerUnit: number }[]
    materialRates: { materialId: string; materialName: string; materialUnit: string; qtyPerUnit: number }[]
  }[]
}

export function serializeCatalogActivity(a: SerializableCatalogActivity): CatalogActivityDTO {
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    unit: a.unit,
    lumpsumBhd: a.lumpsumBhd == null ? null : Number(a.lumpsumBhd),
    description: a.description,
    isActive: a.isActive,
    sortOrder: a.sortOrder,
    subActivities: a.subActivities.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      lumpsumBhd: s.lumpsumBhd == null ? null : Number(s.lumpsumBhd),
      isImplicit: s.isImplicit,
      manpowerRates: s.manpowerRates.map((r) => ({
        laborCategoryId: r.laborCategoryId,
        laborCategoryName: r.category.name,
        hoursPerUnit: Number(r.hoursPerUnit),
      })),
      materialRates: s.materialRates.map((r) => ({
        materialId: r.materialId,
        materialName: r.material.name,
        materialUnit: r.material.unit,
        qtyPerUnit: Number(r.qtyPerUnit),
      })),
    })),
  }
}
