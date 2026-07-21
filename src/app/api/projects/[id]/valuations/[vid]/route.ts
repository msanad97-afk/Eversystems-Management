import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { computeValuation, computationToHeader, computationToLines, loadValuation, loadRevisionHistory, certifyBlockers } from '@/lib/valuation.server'

/** One revision — live or superseded — with its frozen per-asset lines. ADMIN-only. */
export async function GET(_req: NextRequest, { params }: { params: { id: string; vid: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const valuation = await loadValuation(params.id, params.vid)
  if (!valuation) return NextResponse.json({ error: 'Valuation not found.' }, { status: 404 })

  const [history, blockers] = await Promise.all([
    loadRevisionHistory(params.id, new Date(`${valuation.periodMonth}T00:00:00.000Z`)),
    certifyBlockers(params.id),
  ])
  return NextResponse.json({ valuation, history, blockers })
}

/**
 * DRAFT only: recompute the certificate from current approved data, and/or set the expected
 * receipt date. A CERTIFIED revision is frozen — correcting one means re-issuing it.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string; vid: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const existing = await prisma.valuation.findFirst({
    where: { id: params.vid, projectId: params.id },
    select: { id: true, valuationCode: true, status: true, periodMonth: true },
  })
  if (!existing) return NextResponse.json({ error: 'Valuation not found.' }, { status: 404 })
  if (existing.status !== 'DRAFT') {
    return NextResponse.json({ error: `Only a DRAFT certificate can be edited (this one is ${existing.status}).` }, { status: 409 })
  }

  const body = (await req.json().catch(() => null)) ?? {}
  const periodMonth = existing.periodMonth.toISOString().slice(0, 10)

  let expectedReceipt: Date | null | undefined
  if ('expectedReceipt' in body) {
    if (body.expectedReceipt == null || body.expectedReceipt === '') expectedReceipt = null
    else if (typeof body.expectedReceipt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.expectedReceipt)) {
      expectedReceipt = new Date(`${body.expectedReceipt}T00:00:00.000Z`)
    } else {
      return NextResponse.json({ error: 'expectedReceipt must be YYYY-MM-DD or null.' }, { status: 400 })
    }
  }

  const computed = await computeValuation(params.id, periodMonth)
  if (!computed) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })

  await prisma.$transaction(async (tx) => {
    await tx.valuationLine.deleteMany({ where: { valuationId: existing.id } })
    await tx.valuation.update({
      where: { id: existing.id },
      data: {
        ...computationToHeader(computed),
        ...(expectedReceipt === undefined ? {} : { expectedReceipt }),
        lines: { create: computationToLines(computed) },
      },
    })
  })

  writeAuditLog({
    action: 'VALUATION_UPDATED',
    userId: guard.user.id,
    projectId: params.id,
    entity: 'Valuation',
    entityId: existing.id,
    entityCode: existing.valuationCode,
    metadata: { periodMonth, cumulativeGross: computed.cumulativeGross, netPayable: computed.netThisPeriod },
    ipAddress: getClientIp(req),
  })

  const valuation = await loadValuation(params.id, existing.id)
  return NextResponse.json({ valuation })
}
