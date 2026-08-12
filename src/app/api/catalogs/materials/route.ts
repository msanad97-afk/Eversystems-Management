import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser, requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { isNonEmptyString } from '@/lib/validation'

/** Phase 6A: unitRate is a COST rate — returned to ADMIN only (money is admin-only). */
function parseRate(v: unknown): number | null | undefined {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

// Stage 2A-1: an optional supplier link. Suppliers carry NO pricing, and the field is exposed to
// ADMIN only (alongside unitRate), so no supplier data reaches a supervisor material serializer.
const adminSelect = {
  id: true, name: true, unit: true, isActive: true, sortOrder: true, unitRate: true,
  supplierId: true, supplier: { select: { name: true } },
} as const

function shapeAdmin(m: { unitRate: unknown; supplier: { name: string } | null } & Record<string, unknown>) {
  const { unitRate, supplier, ...rest } = m
  return { ...rest, unitRate: unitRate == null ? null : Number(unitRate), supplierName: supplier?.name ?? null }
}

/** Validate a supplierId value: undefined = untouched, null = clear, string = must exist. */
async function resolveSupplier(v: unknown): Promise<{ ok: true; value: string | null | undefined } | { ok: false }> {
  if (v === undefined) return { ok: true, value: undefined }
  if (v === null || v === '') return { ok: true, value: null }
  if (!isNonEmptyString(v)) return { ok: false }
  const s = await prisma.supplier.findUnique({ where: { id: v }, select: { id: true } })
  return s ? { ok: true, value: v } : { ok: false }
}

export async function GET(req: NextRequest) {
  const guard = await requireUser()
  if ('error' in guard) return guard.error

  const isAdmin = guard.user.role === 'ADMIN'
  const wantAll = req.nextUrl.searchParams.get('all') === 'true' && isAdmin
  const rows = await prisma.material.findMany({
    where: wantAll ? undefined : { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: adminSelect,
  })
  // Non-admins get quantities only: strip unitRate AND the supplier link.
  const materials = rows.map(({ unitRate, supplierId, supplier, ...m }) =>
    isAdmin ? { ...m, unitRate: unitRate == null ? null : Number(unitRate), supplierId, supplierName: supplier?.name ?? null } : m,
  )
  return NextResponse.json({ materials })
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const body = await req.json().catch(() => null)
  const name = isNonEmptyString(body?.name) ? body.name.trim() : null
  const unit = isNonEmptyString(body?.unit) ? body.unit.trim() : null
  if (!name || !unit) return NextResponse.json({ error: 'Name and unit are required.' }, { status: 400 })

  const exists = await prisma.material.findUnique({ where: { name } })
  if (exists) return NextResponse.json({ error: 'A material with this name already exists.' }, { status: 409 })

  const supplier = await resolveSupplier(body?.supplierId)
  if (!supplier.ok) return NextResponse.json({ error: 'Unknown supplier.' }, { status: 400 })

  const rate = parseRate(body.unitRate)
  const count = await prisma.material.count()
  const created = await prisma.material.create({
    data: { name, unit, sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : count, unitRate: rate ?? null, supplierId: supplier.value ?? null },
    select: adminSelect,
  })

  writeAuditLog({
    action: 'CATALOG_UPDATED', userId: guard.user.id, entity: 'Material', entityId: created.id,
    metadata: { op: 'create', name, unit }, ipAddress: getClientIp(req),
  })
  return NextResponse.json({ material: shapeAdmin(created) }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const body = await req.json().catch(() => null)
  const id = isNonEmptyString(body?.id) ? body.id : null
  if (!id) return NextResponse.json({ error: 'Material id is required.' }, { status: 400 })

  const existing = await prisma.material.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Material not found.' }, { status: 404 })

  const data: Record<string, unknown> = {}
  if (isNonEmptyString(body.name)) data.name = body.name.trim()
  if (isNonEmptyString(body.unit)) data.unit = body.unit.trim()
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive
  if (typeof body.sortOrder === 'number') data.sortOrder = body.sortOrder
  if ('unitRate' in body) {
    const rate = parseRate(body.unitRate)
    if (rate === undefined) return NextResponse.json({ error: 'Unit rate must be a number of 0 or more.' }, { status: 400 })
    data.unitRate = rate
  }
  if ('supplierId' in body) {
    const supplier = await resolveSupplier(body.supplierId)
    if (!supplier.ok) return NextResponse.json({ error: 'Unknown supplier.' }, { status: 400 })
    data.supplierId = supplier.value ?? null
  }

  if (typeof data.name === 'string' && data.name !== existing.name) {
    const dup = await prisma.material.findUnique({ where: { name: data.name } })
    if (dup) return NextResponse.json({ error: 'A material with this name already exists.' }, { status: 409 })
  }

  const updated = await prisma.material.update({ where: { id }, data, select: adminSelect })
  writeAuditLog({
    action: 'CATALOG_UPDATED', userId: guard.user.id, entity: 'Material', entityId: id,
    metadata: { op: 'update', fields: Object.keys(data) }, ipAddress: getClientIp(req),
  })
  return NextResponse.json({ material: shapeAdmin(updated) })
}

/**
 * Remove a material. Safe rule: if it has never been referenced (no report entries, no
 * catalog rate lines, no frozen budget rows) it is hard-deleted; if it IS referenced
 * anywhere it is deactivated instead, hiding it from new pick-lists while preserving all
 * history. The response says which happened so the UI can explain it.
 */
export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const body = await req.json().catch(() => null)
  const id = isNonEmptyString(body?.id) ? body.id : null
  if (!id) return NextResponse.json({ error: 'Material id is required.' }, { status: 400 })

  const existing = await prisma.material.findUnique({
    where: { id },
    select: { id: true, name: true, _count: { select: { entries: true, catalogRates: true, subActivityBudgets: true } } },
  })
  if (!existing) return NextResponse.json({ error: 'Material not found.' }, { status: 404 })

  const references = existing._count.entries + existing._count.catalogRates + existing._count.subActivityBudgets

  if (references === 0) {
    await prisma.material.delete({ where: { id } })
    writeAuditLog({
      action: 'CATALOG_UPDATED', userId: guard.user.id, entity: 'Material', entityId: id,
      metadata: { op: 'delete', name: existing.name }, ipAddress: getClientIp(req),
    })
    return NextResponse.json({ ok: true, deleted: true, id })
  }

  const updated = await prisma.material.update({
    where: { id },
    data: { isActive: false },
    select: { id: true, name: true, unit: true, isActive: true, sortOrder: true },
  })
  writeAuditLog({
    action: 'CATALOG_UPDATED', userId: guard.user.id, entity: 'Material', entityId: id,
    metadata: { op: 'deactivate', reason: 'in_use', references: existing._count }, ipAddress: getClientIp(req),
  })
  return NextResponse.json({ ok: true, deactivated: true, id, material: updated, references: existing._count })
}
