import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { isNonEmptyString } from '@/lib/validation'

function parsePositive(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const activities = await prisma.activity.findMany({
    where: { assetId: params.id },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, ref: true, name: true, unit: true, boqQuantity: true, isActive: true, sortOrder: true },
  })
  return NextResponse.json({
    activities: activities.map((a) => ({ ...a, boqQuantity: Number(a.boqQuantity) })),
  })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const asset = await prisma.asset.findUnique({ where: { id: params.id }, select: { id: true, projectId: true } })
  if (!asset) return NextResponse.json({ error: 'Asset not found.' }, { status: 404 })

  const body = await req.json().catch(() => null)
  const name = isNonEmptyString(body?.name) ? body.name.trim() : null
  const unit = isNonEmptyString(body?.unit) ? body.unit.trim() : null
  const boq = parsePositive(body?.boqQuantity)
  if (!name || !unit || boq === null) {
    return NextResponse.json({ error: 'Activity name, unit, and a BOQ quantity greater than 0 are required.' }, { status: 400 })
  }

  const count = await prisma.activity.count({ where: { assetId: asset.id } })
  const activity = await prisma.activity.create({
    data: {
      assetId: asset.id,
      name,
      unit,
      boqQuantity: boq,
      ref: isNonEmptyString(body.ref) ? body.ref.trim() : null,
      sortOrder: count,
    },
    select: { id: true, ref: true, name: true, unit: true, boqQuantity: true, isActive: true, sortOrder: true },
  })

  writeAuditLog({
    action: 'ACTIVITY_CREATED',
    userId: guard.user.id,
    projectId: asset.projectId,
    entity: 'Activity',
    entityId: activity.id,
    metadata: { name, unit, boqQuantity: boq },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ activity: { ...activity, boqQuantity: Number(activity.boqQuantity) } }, { status: 201 })
}
