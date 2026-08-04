import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { canRecallRequest } from '@/lib/materialRequests/rules'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireUser()
  if ('error' in guard) return guard.error

  const request = await prisma.materialRequest.findUnique({
    where: { id: params.id },
    select: { id: true, requestedById: true, projectId: true, status: true, requestCode: true },
  })
  if (!request) return NextResponse.json({ error: 'Request not found.' }, { status: 404 })
  if (request.requestedById !== guard.user.id) {
    return NextResponse.json({ error: 'You can only recall your own requests.' }, { status: 403 })
  }
  if (!canRecallRequest(request.status)) {
    return NextResponse.json({ error: 'Only submitted requests can be recalled.' }, { status: 409 })
  }

  await prisma.materialRequest.update({
    where: { id: request.id },
    data: { status: 'DRAFT', submittedAt: null },
  })

  writeAuditLog({
    action: 'MATERIAL_REQUEST_RECALLED',
    userId: guard.user.id,
    projectId: request.projectId,
    entity: 'MaterialRequest',
    entityId: request.id,
    entityCode: request.requestCode,
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ ok: true })
}
