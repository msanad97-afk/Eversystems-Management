import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { isNonEmptyString } from '@/lib/validation'
import { snapshotCatalogActivity } from '@/lib/catalog/snapshot'
import { implicitSubActivityCreate } from '@/lib/catalog/implicitSub'
import { scopeActivitySelect, serializeScopeActivity } from '@/lib/scope'

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
    select: scopeActivitySelect,
  })
  return NextResponse.json({ activities: activities.map(serializeScopeActivity) })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const asset = await prisma.asset.findUnique({ where: { id: params.id }, select: { id: true, projectId: true } })
  if (!asset) return NextResponse.json({ error: 'Asset not found.' }, { status: 404 })

  const body = await req.json().catch(() => null)
  const ref = isNonEmptyString(body?.ref) ? body.ref.trim() : null
  const count = await prisma.activity.count({ where: { assetId: asset.id } })

  // ─── Path 1: place a catalog template (snapshot) ───
  if (isNonEmptyString(body?.catalogActivityId)) {
    const template = await prisma.catalogActivity.findUnique({
      where: { id: body.catalogActivityId },
      select: { id: true, name: true, type: true, isActive: true, lumpsumBhd: true },
    })
    if (!template) return NextResponse.json({ error: 'Catalog activity not found.' }, { status: 404 })
    if (!template.isActive) return NextResponse.json({ error: 'That catalog activity is inactive.' }, { status: 400 })

    let boqQuantity: number | undefined
    let lumpsumOverrideBhd: number | null | undefined
    if (template.type === 'MEASURED') {
      const boq = parsePositive(body.boqQuantity)
      if (boq === null) return NextResponse.json({ error: 'A measured activity needs a BOQ quantity greater than 0.' }, { status: 400 })
      boqQuantity = boq
    } else {
      const override = body.lumpsumBhd === undefined || body.lumpsumBhd === null || body.lumpsumBhd === '' ? undefined : parsePositive(body.lumpsumBhd)
      if (override === null) return NextResponse.json({ error: 'The lumpsum amount must be greater than 0.' }, { status: 400 })
      const effective = override ?? (template.lumpsumBhd ? Number(template.lumpsumBhd) : null)
      if (effective === null) return NextResponse.json({ error: 'This lumpsum template has no default amount — enter one.' }, { status: 400 })
      lumpsumOverrideBhd = override ?? effective
    }

    const created = await prisma.$transaction((tx) =>
      snapshotCatalogActivity(tx, template.id, { assetId: asset.id, sortOrder: count, ref, boqQuantity, lumpsumOverrideBhd }),
    )

    writeAuditLog({
      action: 'ACTIVITY_PLACED_FROM_CATALOG',
      userId: guard.user.id,
      projectId: asset.projectId,
      entity: 'Activity',
      entityId: created.id,
      metadata: { catalogActivityId: template.id, name: template.name, type: template.type },
      ipAddress: getClientIp(req),
    })

    const full = await prisma.activity.findUnique({ where: { id: created.id }, select: scopeActivitySelect })
    return NextResponse.json({ activity: full ? serializeScopeActivity(full) : null }, { status: 201 })
  }

  // ─── Path 2: one-off line (no catalog) ───
  const type: 'MEASURED' | 'LUMPSUM' = body?.type === 'LUMPSUM' ? 'LUMPSUM' : 'MEASURED'
  const name = isNonEmptyString(body?.name) ? body.name.trim() : null
  if (!name) return NextResponse.json({ error: 'Activity name is required.' }, { status: 400 })

  let data: { type: 'MEASURED' | 'LUMPSUM'; unit: string | null; boqQuantity: number; lumpsumBhd: number | null; lumpsumBillBhd: number | null }
  if (type === 'LUMPSUM') {
    const lumpsumBhd = parsePositive(body.lumpsumBhd)
    if (lumpsumBhd === null) return NextResponse.json({ error: 'A lumpsum activity needs a BHD cost amount greater than 0.' }, { status: 400 })
    // Optional contract value; null → bill falls back to cost when derived.
    const bill = body.lumpsumBillBhd === undefined || body.lumpsumBillBhd === null || body.lumpsumBillBhd === '' ? null : parsePositive(body.lumpsumBillBhd)
    if (body.lumpsumBillBhd !== undefined && body.lumpsumBillBhd !== null && body.lumpsumBillBhd !== '' && bill === null) {
      return NextResponse.json({ error: 'The lumpsum contract value must be greater than 0.' }, { status: 400 })
    }
    data = { type, unit: null, boqQuantity: 0, lumpsumBhd, lumpsumBillBhd: bill }
  } else {
    const unit = isNonEmptyString(body?.unit) ? body.unit.trim() : null
    const boq = parsePositive(body?.boqQuantity)
    if (!unit || boq === null) return NextResponse.json({ error: 'A measured activity needs a unit and a BOQ quantity greater than 0.' }, { status: 400 })
    data = { type, unit, boqQuantity: boq, lumpsumBhd: null, lumpsumBillBhd: null }
  }

  const activity = await prisma.activity.create({
    data: {
      assetId: asset.id, name, ref, sortOrder: count, ...data,
      pricedAt: new Date(),
      // One-off lines have no named sub-activities → carry a single implicit sub.
      subActivities: { create: [implicitSubActivityCreate(data.type, data.lumpsumBhd, data.lumpsumBillBhd)] },
    },
    select: scopeActivitySelect,
  })

  writeAuditLog({
    action: 'ACTIVITY_CREATED',
    userId: guard.user.id,
    projectId: asset.projectId,
    entity: 'Activity',
    entityId: activity.id,
    metadata: { name, type, unit: data.unit, boqQuantity: data.boqQuantity, lumpsumBhd: data.lumpsumBhd },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ activity: serializeScopeActivity(activity) }, { status: 201 })
}
