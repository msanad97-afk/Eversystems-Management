import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { canSubmitRequest } from '@/lib/materialRequests/rules'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireUser()
  if ('error' in guard) return guard.error

  const request = await prisma.materialRequest.findUnique({
    where: { id: params.id },
    select: { id: true, requestedById: true, projectId: true, status: true, requestCode: true, _count: { select: { lines: true } } },
  })
  if (!request) return NextResponse.json({ error: 'Request not found.' }, { status: 404 })
  if (request.requestedById !== guard.user.id) {
    return NextResponse.json({ error: 'You can only submit your own requests.' }, { status: 403 })
  }
  if (!canSubmitRequest(request.status)) {
    return NextResponse.json({ error: 'This request cannot be submitted.' }, { status: 409 })
  }
  if (request._count.lines === 0) {
    return NextResponse.json({ error: 'Add at least one material line before submitting.' }, { status: 400 })
  }

  await prisma.materialRequest.update({
    where: { id: request.id },
    data: { status: 'SUBMITTED', submittedAt: new Date() },
  })

  writeAuditLog({
    action: 'MATERIAL_REQUEST_SUBMITTED',
    userId: guard.user.id,
    projectId: request.projectId,
    entity: 'MaterialRequest',
    entityId: request.id,
    entityCode: request.requestCode,
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ ok: true })
}
