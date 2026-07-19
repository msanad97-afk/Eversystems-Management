import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { parseCatalogActivity, subActivityCreateInput, serializeCatalogActivity, catalogActivitySelect } from '@/lib/catalog/payload'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const activity = await prisma.catalogActivity.findUnique({ where: { id: params.id }, select: catalogActivitySelect })
  if (!activity) return NextResponse.json({ error: 'Catalog activity not found.' }, { status: 404 })
  return NextResponse.json({ activity: serializeCatalogActivity(activity) })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const existing = await prisma.catalogActivity.findUnique({ where: { id: params.id }, select: { id: true } })
  if (!existing) return NextResponse.json({ error: 'Catalog activity not found.' }, { status: 404 })

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

  // Light toggle / reorder (no full definition supplied).
  if (!body || typeof body.name !== 'string') {
    const data: { isActive?: boolean; sortOrder?: number } = {}
    if (typeof body?.isActive === 'boolean') data.isActive = body.isActive
    if (typeof body?.sortOrder === 'number') data.sortOrder = body.sortOrder
    if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
    const updated = await prisma.catalogActivity.update({ where: { id: params.id }, data, select: catalogActivitySelect })
    writeAuditLog({
      action: 'CATALOG_ACTIVITY_UPDATED',
      userId: guard.user.id,
      entity: 'CatalogActivity',
      entityId: params.id,
      metadata: { fields: Object.keys(data) },
      ipAddress: getClientIp(req),
    })
    return NextResponse.json({ activity: serializeCatalogActivity(updated) })
  }

  // Full-replace of the definition.
  const parsed = parseCatalogActivity(body)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const dup = await prisma.catalogActivity.findFirst({
    where: { name: parsed.name, id: { not: params.id } },
    select: { id: true },
  })
  if (dup) return NextResponse.json({ error: 'A catalog activity with this name already exists.' }, { status: 409 })

  const updated = await prisma.$transaction(async (tx) => {
    // Replace sub-activities wholesale (cascades their rate lines).
    await tx.catalogSubActivity.deleteMany({ where: { catalogActivityId: params.id } })
    return tx.catalogActivity.update({
      where: { id: params.id },
      data: {
        name: parsed.name,
        type: parsed.type,
        unit: parsed.unit,
        lumpsumBhd: parsed.lumpsumBhd,
        description: parsed.description,
        subActivities: { create: subActivityCreateInput(parsed.subActivities) },
      },
      select: catalogActivitySelect,
    })
  })

  writeAuditLog({
    action: 'CATALOG_ACTIVITY_UPDATED',
    userId: guard.user.id,
    entity: 'CatalogActivity',
    entityId: params.id,
    metadata: { op: 'replace', name: parsed.name, type: parsed.type },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ activity: serializeCatalogActivity(updated) })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const existing = await prisma.catalogActivity.findUnique({ where: { id: params.id }, select: { id: true, name: true } })
  if (!existing) return NextResponse.json({ error: 'Catalog activity not found.' }, { status: 404 })

  // Hard delete is safe: placements are independent copies, and Activity.catalogActivityId
  // is SetNull, so live project budgets are untouched.
  await prisma.catalogActivity.delete({ where: { id: params.id } })

  writeAuditLog({
    action: 'CATALOG_ACTIVITY_DELETED',
    userId: guard.user.id,
    entity: 'CatalogActivity',
    entityId: params.id,
    metadata: { name: existing.name },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ ok: true })
}
