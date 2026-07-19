import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser, requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { isNonEmptyString } from '@/lib/validation'

export async function GET(req: NextRequest) {
  const guard = await requireUser()
  if ('error' in guard) return guard.error

  const wantAll = req.nextUrl.searchParams.get('all') === 'true' && guard.user.role === 'ADMIN'
  const materials = await prisma.material.findMany({
    where: wantAll ? undefined : { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, unit: true, isActive: true, sortOrder: true },
  })
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

  const count = await prisma.material.count()
  const created = await prisma.material.create({
    data: { name, unit, sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : count },
    select: { id: true, name: true, unit: true, isActive: true, sortOrder: true },
  })

  writeAuditLog({
    action: 'CATALOG_UPDATED',
    userId: guard.user.id,
    entity: 'Material',
    entityId: created.id,
    metadata: { op: 'create', name, unit },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ material: created }, { status: 201 })
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

  if (typeof data.name === 'string' && data.name !== existing.name) {
    const dup = await prisma.material.findUnique({ where: { name: data.name } })
    if (dup) return NextResponse.json({ error: 'A material with this name already exists.' }, { status: 409 })
  }

  const updated = await prisma.material.update({
    where: { id },
    data,
    select: { id: true, name: true, unit: true, isActive: true, sortOrder: true },
  })

  writeAuditLog({
    action: 'CATALOG_UPDATED',
    userId: guard.user.id,
    entity: 'Material',
    entityId: id,
    metadata: { op: 'update', fields: Object.keys(data) },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ material: updated })
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
