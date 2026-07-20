// Numeric fields are held as strings so inputs can be empty mid-edit; converted on save.
export interface ManRow {
  key: string
  categoryId: string
  headcount: string
  hours: string
}
export interface MatRow {
  key: string
  materialId: string
  quantity: string
}

/** One reportable line = one sub-activity (implicit ones render at the activity level). */
export interface SubRow {
  key: string
  subActivityId: string
  included: boolean
  quantityDone: string // measured
  percentComplete: string // lumpsum
  note: string
  manpower: ManRow[]
  materials: MatRow[]
}
export interface ActivityRow {
  key: string
  activityId: string
  subs: SubRow[]
}

export interface CategoryOption {
  id: string
  name: string
  isActive: boolean
}
export interface MaterialOption {
  id: string
  name: string
  unit: string
  isActive: boolean
}

// Scope for the report form: assets → activities → sub-activities with cap/budget/floor.
export interface SubActivityOption {
  id: string
  name: string
  type: 'MEASURED' | 'LUMPSUM'
  isImplicit: boolean
  boqQuantity: number
  earned: number
  committed: number
  remaining: number
  lumpsumBhd: number | null
  lastApprovedPercent: number
  budgetManpower: { categoryId: string; categoryName: string; hoursPerUnit: number }[]
  budgetMaterials: { materialId: string; materialName: string; unit: string; qtyPerUnit: number }[]
}
export interface ActivityOption {
  id: string
  ref: string | null
  name: string
  type: 'MEASURED' | 'LUMPSUM'
  unit: string
  subActivities: SubActivityOption[]
}
export interface AssetOption {
  id: string
  ref: string | null
  name: string
  activities: ActivityOption[]
}

let counter = 0
export function newKey(): string {
  counter += 1
  return `row-${counter}`
}
