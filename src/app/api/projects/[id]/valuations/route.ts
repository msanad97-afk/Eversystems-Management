import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { nextCode } from '@/lib/idgen'
import { isPeriodMonth, periodStart } from '@/lib/valuation'
import { computeValuation, computationToHeader, computationToLines, listValuations, certifyBlockers } from '@/lib/valuation.server'

/** Valuations for a project — the live revision of each month. ADMIN-only. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const project = await prisma.project.findUnique({ where: { id: params.id }, select: { id: true } })
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })

  const [valuations, blockers] = await Promise.all([listValuations(project.id), certifyBlockers(project.id)])
  return NextResponse.json({ valuations, blockers })
}

/** Create a DRAFT certificate (revision 0) for a month, computed from approved data. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const project = await prisma.project.findUnique({ where: { id: params.id }, select: { id: true, projectCode: true } })
  if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  if (!isPeriodMonth(body.periodMonth)) {
    return NextResponse.json({ error: 'periodMonth must be the first day of a month (YYYY-MM-01).' }, { status: 400 })
  }
  const periodMonth = periodStart(body.periodMonth)

  // One LIVE revision per month. Superseded revisions of the same month are fine.
  const live = await prisma.valuation.findFirst({
    where: { projectId: project.id, periodMonth, supersededAt: null },
    select: { id: true, valuationCode: true },
  })
  if (live) {
    return NextResponse.json(
      { error: `This month already has a live certificate (${live.valuationCode}). Re-issue it to make changes.` },
      { status: 409 },
    )
  }

  const computed = await computeValuation(project.id, body.periodMonth)
  if (!computed) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })

  const year = body.periodMonth.slice(0, 4)
  const created = await prisma.$transaction(async (tx) => {
    const valuationCode = await nextCode(tx, `valuation:${year}`, `VAL-${year}`, 4)
    return tx.valuation.create({
      data: {
        valuationCode,
        projectId: project.id,
        periodMonth,
        revisionNumber: 0,
        status: 'DRAFT',
        createdBy: guard.user.id,
        ...computationToHeader(computed),
        lines: { create: computationToLines(computed) },
      },
      select: { id: true, valuationCode: true },
    })
  })

  writeAuditLog({
    action: 'VALUATION_CREATED',
    userId: guard.user.id,
    projectId: project.id,
    entity: 'Valuation',
    entityId: created.id,
    entityCode: created.valuationCode,
    metadata: {
      periodMonth: body.periodMonth,
      revisionNumber: 0,
      cumulativeGross: computed.cumulativeGross,
      grossThisPeriod: computed.grossThisPeriod,
      netPayable: computed.netThisPeriod,
    },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ valuation: created }, { status: 201 })
}
