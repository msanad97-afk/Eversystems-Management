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

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const activity = await prisma.activity.findUnique({
    where: { id: params.id },
    select: { id: true, type: true, boqQuantity: true, asset: { select: { projectId: true } } },
  })
  if (!activity) return NextResponse.json({ error: 'Activity not found.' }, { status: 404 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })

  const data: Record<string, unknown> = {}
  if (isNonEmptyString(body.name)) data.name = body.name.trim()
  if (isNonEmptyString(body.unit)) data.unit = body.unit.trim()
  if ('ref' in body) data.ref = isNonEmptyString(body.ref) ? body.ref.trim() : null
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive
  if (typeof body.sortOrder === 'number') data.sortOrder = body.sortOrder
  // BOQ quantity applies to MEASURED lines only.
  if ('boqQuantity' in body && activity.type === 'MEASURED') {
    const boq = parsePositive(body.boqQuantity)
    if (boq === null) return NextResponse.json({ error: 'BOQ quantity must be greater than 0.' }, { status: 400 })
    data.boqQuantity = boq
  }
  // Lumpsum amount applies to LUMPSUM lines only (Q4: editable post-placement).
  if ('lumpsumBhd' in body && activity.type === 'LUMPSUM') {
    const lump = parsePositive(body.lumpsumBhd)
    if (lump === null) return NextResponse.json({ error: 'The lumpsum amount must be greater than 0.' }, { status: 400 })
    data.lumpsumBhd = lump
  }

  const updated = await prisma.activity.update({
    where: { id: activity.id },
    data,
    select: { id: true, ref: true, name: true, unit: true, boqQuantity: true, lumpsumBhd: true, isActive: true, sortOrder: true },
  })

  writeAuditLog({
    action: 'ACTIVITY_UPDATED',
    userId: guard.user.id,
    projectId: activity.asset.projectId,
    entity: 'Activity',
    entityId: activity.id,
    // Editing boqQuantity is audited (§4: lowering below earned is allowed, history intact).
    metadata: { fields: Object.keys(data), ...(data.boqQuantity !== undefined ? { boqFrom: Number(activity.boqQuantity), boqTo: data.boqQuantity } : {}) },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({
    activity: {
      ...updated,
      boqQuantity: Number(updated.boqQuantity),
      lumpsumBhd: updated.lumpsumBhd == null ? null : Number(updated.lumpsumBhd),
    },
  })
}
