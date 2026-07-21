import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'

/** DRAFT → SUBMITTED: the certificate has gone to the client for approval. ADMIN-only. */
export async function POST(req: NextRequest, { params }: { params: { id: string; vid: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const existing = await prisma.valuation.findFirst({
    where: { id: params.vid, projectId: params.id },
    select: { id: true, valuationCode: true, status: true, periodMonth: true },
  })
  if (!existing) return NextResponse.json({ error: 'Valuation not found.' }, { status: 404 })
  if (existing.status !== 'DRAFT') {
    return NextResponse.json({ error: `Only a DRAFT certificate can be submitted (this one is ${existing.status}).` }, { status: 409 })
  }

  await prisma.$transaction(async (tx) => {
    await tx.valuation.update({ where: { id: existing.id }, data: { status: 'SUBMITTED' } })
  })

  writeAuditLog({
    action: 'VALUATION_SUBMITTED',
    userId: guard.user.id,
    projectId: params.id,
    entity: 'Valuation',
    entityId: existing.id,
    entityCode: existing.valuationCode,
    metadata: { periodMonth: existing.periodMonth.toISOString().slice(0, 10) },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ ok: true, status: 'SUBMITTED' })
}
