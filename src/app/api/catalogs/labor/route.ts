import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser, requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { isNonEmptyString } from '@/lib/validation'

/** Phase 6A: hourlyRate is a COST rate — returned to ADMIN only (money is admin-only). */
function parseRate(v: unknown): number | null | undefined {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

export async function GET(req: NextRequest) {
  const guard = await requireUser()
  if ('error' in guard) return guard.error

  const isAdmin = guard.user.role === 'ADMIN'
  const wantAll = req.nextUrl.searchParams.get('all') === 'true' && isAdmin
  const rows = await prisma.laborCategory.findMany({
    where: wantAll ? undefined : { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, isActive: true, sortOrder: true, hourlyRate: true },
  })
  const categories = rows.map(({ hourlyRate, ...c }) =>
    isAdmin ? { ...c, hourlyRate: hourlyRate == null ? null : Number(hourlyRate) } : c,
  )
  return NextResponse.json({ categories })
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const body = await req.json().catch(() => null)
  const name = isNonEmptyString(body?.name) ? body.name.trim() : null
  if (!name) return NextResponse.json({ error: 'Name is required.' }, { status: 400 })

  const exists = await prisma.laborCategory.findUnique({ where: { name } })
  if (exists) return NextResponse.json({ error: 'A category with this name already exists.' }, { status: 409 })

  const rate = parseRate(body.hourlyRate)
  const count = await prisma.laborCategory.count()
  const created = await prisma.laborCategory.create({
    data: { name, sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : count, hourlyRate: rate ?? null },
    select: { id: true, name: true, isActive: true, sortOrder: true, hourlyRate: true },
  })

  writeAuditLog({
    action: 'CATALOG_UPDATED',
    userId: guard.user.id,
    entity: 'LaborCategory',
    entityId: created.id,
    metadata: { op: 'create', name },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json(
    { category: { ...created, hourlyRate: created.hourlyRate == null ? null : Number(created.hourlyRate) } },
    { status: 201 },
  )
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const body = await req.json().catch(() => null)
  const id = isNonEmptyString(body?.id) ? body.id : null
  if (!id) return NextResponse.json({ error: 'Category id is required.' }, { status: 400 })

  const existing = await prisma.laborCategory.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Category not found.' }, { status: 404 })

  const data: Record<string, unknown> = {}
  if (isNonEmptyString(body.name)) data.name = body.name.trim()
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive
  if (typeof body.sortOrder === 'number') data.sortOrder = body.sortOrder
  if ('hourlyRate' in body) {
    const rate = parseRate(body.hourlyRate)
    if (rate === undefined) return NextResponse.json({ error: 'Hourly rate must be a number of 0 or more.' }, { status: 400 })
    data.hourlyRate = rate
  }

  if (typeof data.name === 'string' && data.name !== existing.name) {
    const dup = await prisma.laborCategory.findUnique({ where: { name: data.name } })
    if (dup) return NextResponse.json({ error: 'A category with this name already exists.' }, { status: 409 })
  }

  const updated = await prisma.laborCategory.update({
    where: { id },
    data,
    select: { id: true, name: true, isActive: true, sortOrder: true, hourlyRate: true },
  })

  writeAuditLog({
    action: 'CATALOG_UPDATED',
    userId: guard.user.id,
    entity: 'LaborCategory',
    entityId: id,
    metadata: { op: 'update', fields: Object.keys(data) },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ category: { ...updated, hourlyRate: updated.hourlyRate == null ? null : Number(updated.hourlyRate) } })
}

/**
 * Remove a labour category. Safe rule: if it has never been referenced (no report
 * manpower entries, no catalog rate lines, no frozen budget rows) it is hard-deleted;
 * if it IS referenced anywhere it is deactivated instead, hiding it from new pick-lists
 * while preserving all history. The response says which happened so the UI can explain it.
 */
export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const body = await req.json().catch(() => null)
  const id = isNonEmptyString(body?.id) ? body.id : null
  if (!id) return NextResponse.json({ error: 'Category id is required.' }, { status: 400 })

  const existing = await prisma.laborCategory.findUnique({
    where: { id },
    select: { id: true, name: true, _count: { select: { entries: true, catalogRates: true, subActivityBudgets: true } } },
  })
  if (!existing) return NextResponse.json({ error: 'Category not found.' }, { status: 404 })

  const references = existing._count.entries + existing._count.catalogRates + existing._count.subActivityBudgets

  if (references === 0) {
    await prisma.laborCategory.delete({ where: { id } })
    writeAuditLog({
      action: 'CATALOG_UPDATED', userId: guard.user.id, entity: 'LaborCategory', entityId: id,
      metadata: { op: 'delete', name: existing.name }, ipAddress: getClientIp(req),
    })
    return NextResponse.json({ ok: true, deleted: true, id })
  }

  const updated = await prisma.laborCategory.update({
    where: { id },
    data: { isActive: false },
    select: { id: true, name: true, isActive: true, sortOrder: true },
  })
  writeAuditLog({
    action: 'CATALOG_UPDATED', userId: guard.user.id, entity: 'LaborCategory', entityId: id,
    metadata: { op: 'deactivate', reason: 'in_use', references: existing._count }, ipAddress: getClientIp(req),
  })
  return NextResponse.json({ ok: true, deactivated: true, id, category: updated, references: existing._count })
}
