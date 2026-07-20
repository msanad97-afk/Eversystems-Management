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
/** Money field: null/'' clears it, a number ≥ 0 sets it, anything else is invalid. */
function parseMoney(v: unknown): number | null | undefined {
  if (v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : undefined
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
    if (lump === null) return NextResponse.json({ error: 'The lumpsum cost must be greater than 0.' }, { status: 400 })
    data.lumpsumBhd = lump
  }
  // ─── Phase 6A money fields (ADMIN-only route already) ───
  // Contract value for a lumpsum line; null clears it so bill falls back to cost.
  if ('lumpsumBillBhd' in body && activity.type === 'LUMPSUM') {
    const v = parseMoney(body.lumpsumBillBhd)
    if (v === undefined) return NextResponse.json({ error: 'The lumpsum contract value must be a number of 0 or more.' }, { status: 400 })
    data.lumpsumBillBhd = v
  }
  // costRate = fallback cost/unit for bare measured lines; billRate = revenue per unit.
  if ('costRate' in body && activity.type === 'MEASURED') {
    const v = parseMoney(body.costRate)
    if (v === undefined) return NextResponse.json({ error: 'Cost rate must be a number of 0 or more.' }, { status: 400 })
    data.costRate = v
  }
  if ('billRate' in body && activity.type === 'MEASURED') {
    const v = parseMoney(body.billRate)
    if (v === undefined) return NextResponse.json({ error: 'Bill rate must be a number of 0 or more.' }, { status: 400 })
    data.billRate = v
  }

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.activity.update({
      where: { id: activity.id },
      data,
      select: { id: true, ref: true, name: true, unit: true, boqQuantity: true, lumpsumBhd: true, isActive: true, sortOrder: true },
    })
    // Keep the implicit lumpsum sub-activity's frozen amount in sync (it is the source of
    // truth for budget/earned derivation, C2).
    if (data.lumpsumBhd !== undefined) {
      await tx.subActivity.updateMany({
        where: { activityId: activity.id, isImplicit: true, type: 'LUMPSUM' },
        data: { lumpsumBhd: data.lumpsumBhd as number },
      })
    }
    return u
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
