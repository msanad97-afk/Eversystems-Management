import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { baseCode, revisionCode } from '@/lib/valuation'
import { computeValuation, computationToHeader, computationToLines } from '@/lib/valuation.server'

/**
 * Re-issue a certified certificate the client has asked to change. There is no un-certify:
 * the approved revision is superseded (frozen and still readable — the record of what was
 * approved is never overwritten) and a fresh DRAFT revision is created from current approved
 * data. Both happen in ONE transaction, so a month can never end up with two live revisions.
 *
 * The cumulative ripple is accepted and deliberate: each certified revision keeps its own
 * frozen previousGross, so re-issuing month 3 does not silently rewrite month 4's already
 * approved certificate — the correction surfaces when a downstream month is next prepared.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string; vid: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const existing = await prisma.valuation.findFirst({
    where: { id: params.vid, projectId: params.id },
    select: { id: true, valuationCode: true, status: true, periodMonth: true, revisionNumber: true, supersededAt: true },
  })
  if (!existing) return NextResponse.json({ error: 'Valuation not found.' }, { status: 404 })
  if (existing.supersededAt != null) {
    return NextResponse.json({ error: 'This revision has already been superseded. Re-issue the live revision instead.' }, { status: 409 })
  }
  if (existing.status !== 'CERTIFIED') {
    return NextResponse.json(
      { error: `Only a CERTIFIED certificate can be re-issued (this one is ${existing.status}). Edit the draft instead.` },
      { status: 409 },
    )
  }

  const periodMonth = existing.periodMonth.toISOString().slice(0, 10)
  const computed = await computeValuation(params.id, periodMonth)
  if (!computed) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })

  const revisionNumber = existing.revisionNumber + 1
  const supersededAt = new Date()

  const created = await prisma.$transaction(async (tx) => {
    // Re-read inside the transaction so two concurrent re-issues cannot both supersede.
    const live = await tx.valuation.updateMany({
      where: { id: existing.id, supersededAt: null },
      data: { supersededAt },
    })
    if (live.count !== 1) throw new Error('SUPERSEDE_RACE')

    return tx.valuation.create({
      data: {
        valuationCode: revisionCode(baseCode(existing.valuationCode), revisionNumber),
        projectId: params.id,
        periodMonth: existing.periodMonth,
        revisionNumber,
        status: 'DRAFT',
        createdBy: guard.user.id,
        ...computationToHeader(computed),
        lines: { create: computationToLines(computed) },
      },
      select: { id: true, valuationCode: true, revisionNumber: true },
    })
  }).catch((err: unknown) => {
    if (err instanceof Error && err.message === 'SUPERSEDE_RACE') return null
    throw err
  })

  if (!created) {
    return NextResponse.json({ error: 'This certificate was re-issued by someone else. Reload and try again.' }, { status: 409 })
  }

  writeAuditLog({
    action: 'VALUATION_REISSUED',
    userId: guard.user.id,
    projectId: params.id,
    entity: 'Valuation',
    entityId: created.id,
    entityCode: created.valuationCode,
    metadata: {
      periodMonth,
      supersededId: existing.id,
      supersededCode: existing.valuationCode,
      revisionNumber,
      cumulativeGross: computed.cumulativeGross,
      netPayable: computed.netThisPeriod,
    },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ valuation: created }, { status: 201 })
}
