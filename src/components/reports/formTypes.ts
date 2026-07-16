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
export interface ActivityRow {
  key: string
  activityId: string
  quantityDone: string
  note: string
  manpower: ManRow[]
  materials: MatRow[]
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

// Project scope for the report form: assets → activities with BOQ/earned/committed/remaining
// (remaining already excludes the report being edited).
export interface ActivityOption {
  id: string
  ref: string | null
  name: string
  unit: string
  boqQuantity: number
  earned: number
  committed: number
  remaining: number
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
