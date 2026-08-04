import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { isNonEmptyString } from '@/lib/validation'
import { canReviewRequest, resolveReviewStatus, validateApprovedQty, type ReviewLine } from '@/lib/materialRequests/rules'

/** ADMIN review: per-line approve/modify/reject. Body: { decisions: [{lineId, approvedQty}], note? } */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const body = await req.json().catch(() => null)
  const note = isNonEmptyString(body?.note) ? body.note.trim() : null
  const rawDecisions = Array.isArray(body?.decisions) ? body.decisions : null
  if (!rawDecisions) return NextResponse.json({ error: 'Review decisions are required.' }, { status: 400 })

  const request = await prisma.materialRequest.findUnique({
    where: { id: params.id },
    select: {
      id: true, status: true, projectId: true, requestCode: true,
      lines: { select: { id: true, requestedQty: true } },
    },
  })
  if (!request) return NextResponse.json({ error: 'Request not found.' }, { status: 404 })
  if (!canReviewRequest(request.status)) {
    return NextResponse.json({ error: 'Only submitted requests can be reviewed.' }, { status: 409 })
  }

  // Map decisions by lineId and require exactly one valid decision per line.
  const decisionByLine = new Map<string, number>()
  for (const d of rawDecisions) {
    const lineId = isNonEmptyString(d?.lineId) ? d.lineId : null
    const approvedQty = (d as { approvedQty?: unknown })?.approvedQty
    if (!lineId || !validateApprovedQty(approvedQty)) {
      return NextResponse.json({ error: 'Each line needs an approved quantity of zero or more.' }, { status: 400 })
    }
    decisionByLine.set(lineId, approvedQty)
  }
  if (decisionByLine.size !== request.lines.length || request.lines.some((l) => !decisionByLine.has(l.id))) {
    return NextResponse.json({ error: 'A decision is required for every line.' }, { status: 400 })
  }

  const reviewLines: ReviewLine[] = request.lines.map((l) => ({ requestedQty: Number(l.requestedQty), approvedQty: decisionByLine.get(l.id)! }))
  const status = resolveReviewStatus(reviewLines)

  await prisma.$transaction(async (tx) => {
    for (const l of request.lines) {
      await tx.materialRequestLine.update({ where: { id: l.id }, data: { approvedQty: decisionByLine.get(l.id)! } })
    }
    await tx.materialRequest.update({
      where: { id: request.id },
      data: { status, reviewedById: guard.user.id, reviewedAt: new Date(), reviewNote: note },
    })
  })

  writeAuditLog({
    action: 'MATERIAL_REQUEST_REVIEWED',
    userId: guard.user.id,
    projectId: request.projectId,
    entity: 'MaterialRequest',
    entityId: request.id,
    entityCode: request.requestCode,
    metadata: { status, note },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ ok: true, status })
}
