import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { isNonEmptyString } from '@/lib/validation'

/**
 * Supplier catalogue — ADMIN ONLY (every method). Suppliers carry contact details only, NO
 * pricing. A supplier with materials attached is deactivated, never deleted; deletion is allowed
 * only when unreferenced.
 */

const supplierSelect = {
  id: true, name: true, contactName: true, contactPhone: true, contactEmail: true,
  isActive: true, createdAt: true, _count: { select: { materials: true } },
} as const

function shape(s: { _count: { materials: number }; createdAt: Date } & Record<string, unknown>) {
  const { _count, createdAt, ...rest } = s
  return { ...rest, materialCount: _count.materials, createdAt: createdAt.toISOString() }
}
const optStr = (v: unknown): string | null => (isNonEmptyString(v) ? v.trim() : null)

export async function GET(_req: NextRequest) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const rows = await prisma.supplier.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }], select: supplierSelect })
  return NextResponse.json({ suppliers: rows.map(shape) })
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const body = await req.json().catch(() => null)
  const name = isNonEmptyString(body?.name) ? body.name.trim() : null
  if (!name) return NextResponse.json({ error: 'Supplier name is required.' }, { status: 400 })
  if (await prisma.supplier.findUnique({ where: { name } })) {
    return NextResponse.json({ error: 'A supplier with this name already exists.' }, { status: 409 })
  }

  const created = await prisma.supplier.create({
    data: { name, contactName: optStr(body.contactName), contactPhone: optStr(body.contactPhone), contactEmail: optStr(body.contactEmail) },
    select: supplierSelect,
  })

  writeAuditLog({
    action: 'SUPPLIER_CREATED', userId: guard.user.id, entity: 'Supplier', entityId: created.id,
    metadata: { name }, ipAddress: getClientIp(req),
  })
  return NextResponse.json({ supplier: shape(created) }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const body = await req.json().catch(() => null)
  const id = isNonEmptyString(body?.id) ? body.id : null
  if (!id) return NextResponse.json({ error: 'Supplier id is required.' }, { status: 400 })

  const existing = await prisma.supplier.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Supplier not found.' }, { status: 404 })

  const data: Record<string, unknown> = {}
  if (isNonEmptyString(body.name)) data.name = body.name.trim()
  if ('contactName' in body) data.contactName = optStr(body.contactName)
  if ('contactPhone' in body) data.contactPhone = optStr(body.contactPhone)
  if ('contactEmail' in body) data.contactEmail = optStr(body.contactEmail)
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive

  if (typeof data.name === 'string' && data.name !== existing.name) {
    if (await prisma.supplier.findUnique({ where: { name: data.name } })) {
      return NextResponse.json({ error: 'A supplier with this name already exists.' }, { status: 409 })
    }
  }

  const updated = await prisma.supplier.update({ where: { id }, data, select: supplierSelect })
  writeAuditLog({
    action: 'SUPPLIER_UPDATED', userId: guard.user.id, entity: 'Supplier', entityId: id,
    metadata: { op: 'update', fields: Object.keys(data) }, ipAddress: getClientIp(req),
  })
  return NextResponse.json({ supplier: shape(updated) })
}

/** Delete only when no material references the supplier; otherwise refuse (deactivate instead). */
export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const body = await req.json().catch(() => null)
  const id = isNonEmptyString(body?.id) ? body.id : null
  if (!id) return NextResponse.json({ error: 'Supplier id is required.' }, { status: 400 })

  const existing = await prisma.supplier.findUnique({ where: { id }, select: { id: true, name: true, _count: { select: { materials: true } } } })
  if (!existing) return NextResponse.json({ error: 'Supplier not found.' }, { status: 404 })

  if (existing._count.materials > 0) {
    return NextResponse.json(
      { error: 'This supplier has materials attached. Deactivate it instead of deleting.' },
      { status: 409 },
    )
  }

  await prisma.supplier.delete({ where: { id } })
  writeAuditLog({
    action: 'SUPPLIER_UPDATED', userId: guard.user.id, entity: 'Supplier', entityId: id,
    metadata: { op: 'delete', name: existing.name }, ipAddress: getClientIp(req),
  })
  return NextResponse.json({ ok: true, deleted: true, id })
}
