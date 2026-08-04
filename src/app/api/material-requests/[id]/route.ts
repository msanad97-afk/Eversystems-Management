import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { isNonEmptyString } from '@/lib/validation'
import { canEditRequest, validateRequestLines, type RequestLineInput } from '@/lib/materialRequests/rules'

function parseLines(raw: unknown): RequestLineInput[] | null {
  if (!Array.isArray(raw)) return null
  const lines: RequestLineInput[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') return null
    const materialId = isNonEmptyString((r as { materialId?: unknown }).materialId) ? (r as { materialId: string }).materialId : ''
    const requestedQty = Number((r as { requestedQty?: unknown }).requestedQty)
    const noteRaw = (r as { note?: unknown }).note
    if (!materialId || !Number.isFinite(requestedQty)) return null
    lines.push({ materialId, requestedQty, note: isNonEmptyString(noteRaw) ? noteRaw.trim() : null })
  }
  return lines
}

/** Edit a DRAFT request's scope + lines (author only). Replaces all lines. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireUser()
  if ('error' in guard) return guard.error

  const request = await prisma.materialRequest.findUnique({
    where: { id: params.id },
    select: { id: true, requestedById: true, projectId: true, status: true, requestCode: true },
  })
  if (!request) return NextResponse.json({ error: 'Request not found.' }, { status: 404 })
  if (request.requestedById !== guard.user.id) {
    return NextResponse.json({ error: 'You can only edit your own requests.' }, { status: 403 })
  }
  if (!canEditRequest(request.status)) {
    return NextResponse.json({ error: 'Only draft requests can be edited.' }, { status: 409 })
  }

  const body = await req.json().catch(() => null)
  const assetId = isNonEmptyString(body?.assetId) ? body.assetId : null
  const activityId = isNonEmptyString(body?.activityId) ? body.activityId : null
  const lines = parseLines(body?.lines)
  if (!lines) return NextResponse.json({ error: 'Invalid material lines.' }, { status: 400 })
  const lineError = validateRequestLines(lines)
  if (lineError) return NextResponse.json({ error: lineError }, { status: 400 })

  if (assetId) {
    const asset = await prisma.asset.findUnique({ where: { id: assetId }, select: { projectId: true } })
    if (!asset || asset.projectId !== request.projectId) return NextResponse.json({ error: 'That asset is not in this project.' }, { status: 400 })
  }
  if (activityId) {
    const activity = await prisma.activity.findUnique({ where: { id: activityId }, select: { asset: { select: { projectId: true, id: true } } } })
    if (!activity || activity.asset.projectId !== request.projectId) return NextResponse.json({ error: 'That activity is not in this project.' }, { status: 400 })
    if (assetId && activity.asset.id !== assetId) return NextResponse.json({ error: 'Activity does not belong to the chosen asset.' }, { status: 400 })
  }

  const materials = await prisma.material.findMany({ where: { id: { in: lines.map((l) => l.materialId) } }, select: { id: true, unit: true } })
  const unitById = new Map(materials.map((m) => [m.id, m.unit]))
  if (unitById.size !== new Set(lines.map((l) => l.materialId)).size) {
    return NextResponse.json({ error: 'One or more materials were not found.' }, { status: 400 })
  }

  await prisma.$transaction(async (tx) => {
    await tx.materialRequestLine.deleteMany({ where: { requestId: request.id } })
    await tx.materialRequest.update({
      where: { id: request.id },
      data: {
        assetId,
        activityId,
        lines: {
          create: lines.map((l, i) => ({ materialId: l.materialId, unit: unitById.get(l.materialId)!, requestedQty: l.requestedQty, note: l.note ?? null, sortOrder: i })),
        },
      },
    })
  })

  writeAuditLog({
    action: 'MATERIAL_REQUEST_CREATED', // content revised while DRAFT (pre-submission edit)
    userId: guard.user.id,
    projectId: request.projectId,
    entity: 'MaterialRequest',
    entityId: request.id,
    entityCode: request.requestCode,
    metadata: { edited: true, lineCount: lines.length },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ ok: true })
}

/** Delete a DRAFT request (author only). Reviewed/submitted requests are never deleted. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireUser()
  if ('error' in guard) return guard.error

  const request = await prisma.materialRequest.findUnique({
    where: { id: params.id },
    select: { id: true, requestedById: true, status: true },
  })
  if (!request) return NextResponse.json({ error: 'Request not found.' }, { status: 404 })
  if (request.requestedById !== guard.user.id) {
    return NextResponse.json({ error: 'You can only delete your own requests.' }, { status: 403 })
  }
  if (request.status !== 'DRAFT') {
    return NextResponse.json({ error: 'Only draft requests can be deleted.' }, { status: 409 })
  }

  await prisma.materialRequest.delete({ where: { id: request.id } })
  return NextResponse.json({ ok: true })
}
