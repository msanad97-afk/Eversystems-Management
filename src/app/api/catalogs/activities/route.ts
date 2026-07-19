import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { parseCatalogActivity, subActivityCreateInput, serializeCatalogActivity, catalogActivitySelect } from '@/lib/catalog/payload'

export async function GET(req: NextRequest) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const wantAll = req.nextUrl.searchParams.get('all') === 'true'
  const activities = await prisma.catalogActivity.findMany({
    where: wantAll ? undefined : { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: catalogActivitySelect,
  })
  return NextResponse.json({ activities: activities.map(serializeCatalogActivity) })
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const parsed = parseCatalogActivity(await req.json().catch(() => null))
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const dup = await prisma.catalogActivity.findUnique({ where: { name: parsed.name }, select: { id: true } })
  if (dup) return NextResponse.json({ error: 'A catalog activity with this name already exists.' }, { status: 409 })

  const count = await prisma.catalogActivity.count()
  const created = await prisma.catalogActivity.create({
    data: {
      name: parsed.name,
      type: parsed.type,
      unit: parsed.unit,
      lumpsumBhd: parsed.lumpsumBhd,
      description: parsed.description,
      sortOrder: count,
      subActivities: { create: subActivityCreateInput(parsed.subActivities) },
    },
    select: catalogActivitySelect,
  })

  writeAuditLog({
    action: 'CATALOG_ACTIVITY_CREATED',
    userId: guard.user.id,
    entity: 'CatalogActivity',
    entityId: created.id,
    metadata: { name: parsed.name, type: parsed.type },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ activity: serializeCatalogActivity(created) }, { status: 201 })
}
