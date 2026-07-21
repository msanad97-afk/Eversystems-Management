import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { expectedReceiptDate } from '@/lib/valuation'
import { computeValuation, computationToHeader, computationToLines, certifyBlockers } from '@/lib/valuation.server'

/**
 * Record the client's approval of a certificate. This is the freeze point: the header money,
 * the per-asset lines and the retention/advance/contract-value PARAMETERS are all snapshotted
 * onto this revision. Nothing afterwards — a new approved report, a re-measure, a re-price —
 * can move it. A change the client requires is handled by re-issuing, never by mutating.
 *
 * Hard-blocked while any scope would certify at zero (6D.6): under-billing a client
 * certificate is a real financial loss, unlike report approval which tolerates unpriced work.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string; vid: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const existing = await prisma.valuation.findFirst({
    where: { id: params.vid, projectId: params.id },
    select: { id: true, valuationCode: true, status: true, periodMonth: true, supersededAt: true },
  })
  if (!existing) return NextResponse.json({ error: 'Valuation not found.' }, { status: 404 })
  if (existing.status !== 'DRAFT' && existing.status !== 'SUBMITTED') {
    return NextResponse.json({ error: `Only a DRAFT or SUBMITTED certificate can be certified (this one is ${existing.status}).` }, { status: 409 })
  }
  if (existing.supersededAt != null) {
    return NextResponse.json({ error: 'This revision has been superseded and can no longer be certified.' }, { status: 409 })
  }

  const blockers = await certifyBlockers(params.id)
  if (blockers.length > 0) {
    return NextResponse.json(
      { error: 'Certification is blocked: some scope would certify at zero. Price it first.', blockers },
      { status: 409 },
    )
  }

  const periodMonth = existing.periodMonth.toISOString().slice(0, 10)
  const [computed, project] = await Promise.all([
    computeValuation(params.id, periodMonth),
    prisma.project.findUnique({ where: { id: params.id }, select: { retentionPct: true, retentionCapPct: true, advancePct: true, paymentTermsDays: true } }),
  ])
  if (!computed || !project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 })

  const certifiedAt = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.valuationLine.deleteMany({ where: { valuationId: existing.id } })
    await tx.valuation.update({
      where: { id: existing.id },
      data: {
        ...computationToHeader(computed),
        status: 'CERTIFIED',
        certifiedAt,
        expectedReceipt: expectedReceiptDate(certifiedAt, project.paymentTermsDays),
        // Parameter snapshots — what this certificate was actually approved against.
        contractValueAtCert: computed.contractValue,
        retentionPctAtCert: project.retentionPct,
        advancePctAtCert: project.advancePct,
        lines: { create: computationToLines(computed) },
      },
    })
  })

  writeAuditLog({
    action: 'VALUATION_CERTIFIED',
    userId: guard.user.id,
    projectId: params.id,
    entity: 'Valuation',
    entityId: existing.id,
    entityCode: existing.valuationCode,
    metadata: {
      periodMonth,
      cumulativeGross: computed.cumulativeGross,
      grossThisPeriod: computed.grossThisPeriod,
      retentionHeld: computed.retentionHeld,
      advanceRecovery: computed.advanceRecovery,
      netPayable: computed.netThisPeriod,
      contractValueAtCert: computed.contractValue,
    },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ ok: true, status: 'CERTIFIED', certifiedAt: certifiedAt.toISOString() })
}
