import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth/permissions'
import { nextCode } from '@/lib/idgen'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { isNonEmptyString } from '@/lib/validation'
import { validateRequestLines, type RequestLineInput } from '@/lib/materialRequests/rules'

/** Parse + coerce the raw line payload into typed request lines. */
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

export async function POST(req: NextRequest) {
  const guard = await requireUser()
  if ('error' in guard) return guard.error
  if (guard.user.role === 'VIEWER') {
    return NextResponse.json({ error: 'Viewers cannot raise requests.' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  const projectId = isNonEmptyString(body?.projectId) ? body.projectId : null
  const assetId = isNonEmptyString(body?.assetId) ? body.assetId : null
  const activityId = isNonEmptyString(body?.activityId) ? body.activityId : null
  if (!projectId) return NextResponse.json({ error: 'A project is required.' }, { status: 400 })

  const lines = parseLines(body?.lines)
  if (!lines) return NextResponse.json({ error: 'Invalid material lines.' }, { status: 400 })
  const lineError = validateRequestLines(lines)
  if (lineError) return NextResponse.json({ error: lineError }, { status: 400 })

  // Author must be a member of the project (supervisors act only where assigned).
  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: guard.user.id } },
  })
  if (!membership) return NextResponse.json({ error: 'You are not assigned to this project.' }, { status: 403 })

  // Scope narrowing must stay within the project.
  if (assetId) {
    const asset = await prisma.asset.findUnique({ where: { id: assetId }, select: { projectId: true } })
    if (!asset || asset.projectId !== projectId) return NextResponse.json({ error: 'That asset is not in this project.' }, { status: 400 })
  }
  if (activityId) {
    const activity = await prisma.activity.findUnique({ where: { id: activityId }, select: { asset: { select: { projectId: true, id: true } } } })
    if (!activity || activity.asset.projectId !== projectId) return NextResponse.json({ error: 'That activity is not in this project.' }, { status: 400 })
    if (assetId && activity.asset.id !== assetId) return NextResponse.json({ error: 'Activity does not belong to the chosen asset.' }, { status: 400 })
  }

  // Freeze each line's material unit label; only catalogue materials are allowed.
  const materials = await prisma.material.findMany({
    where: { id: { in: lines.map((l) => l.materialId) } },
    select: { id: true, unit: true },
  })
  const unitById = new Map(materials.map((m) => [m.id, m.unit]))
  if (unitById.size !== new Set(lines.map((l) => l.materialId)).size) {
    return NextResponse.json({ error: 'One or more materials were not found.' }, { status: 400 })
  }

  const year = new Date().getUTCFullYear()
  const created = await prisma.$transaction(async (tx) => {
    const requestCode = await nextCode(tx, `matreq:${year}`, `MR-${year}`, 4)
    return tx.materialRequest.create({
      data: {
        requestCode,
        projectId,
        assetId,
        activityId,
        status: 'DRAFT',
        requestedById: guard.user.id,
        lines: {
          create: lines.map((l, i) => ({
            materialId: l.materialId,
            unit: unitById.get(l.materialId)!,
            requestedQty: l.requestedQty,
            note: l.note ?? null,
            sortOrder: i,
          })),
        },
      },
      select: { id: true, requestCode: true },
    })
  })

  writeAuditLog({
    action: 'MATERIAL_REQUEST_CREATED',
    userId: guard.user.id,
    projectId,
    entity: 'MaterialRequest',
    entityId: created.id,
    entityCode: created.requestCode,
    metadata: { lineCount: lines.length, assetId, activityId },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ request: created }, { status: 201 })
}
