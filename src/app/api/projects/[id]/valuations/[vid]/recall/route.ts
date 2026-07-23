import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'

/**
 * Recall a SUBMITTED certificate back to DRAFT — the client handed it back before approving.
 * Mirrors the report recall (REPORT_RECALLED). This is for BEFORE approval; re-issue is for
 * after (CERTIFIED-only) — the two are deliberately not merged. ADMIN-only.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string; vid: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const existing = await prisma.valuation.findFirst({
    where: { id: params.vid, projectId: params.id },
    select: { id: true, valuationCode: true, status: true, supersededAt: true, periodMonth: true },
  })
  if (!existing) return NextResponse.json({ error: 'Valuation not found.' }, { status: 404 })
  if (existing.status !== 'SUBMITTED') {
    return NextResponse.json({ error: `Only a SUBMITTED certificate can be recalled (this one is ${existing.status}).` }, { status: 409 })
  }
  if (existing.supersededAt != null) {
    return NextResponse.json({ error: 'This revision has been superseded and cannot be recalled.' }, { status: 409 })
  }

  await prisma.valuation.update({ where: { id: existing.id }, data: { status: 'DRAFT' } })

  writeAuditLog({
    action: 'VALUATION_RECALLED',
    userId: guard.user.id,
    projectId: params.id,
    entity: 'Valuation',
    entityId: existing.id,
    entityCode: existing.valuationCode,
    metadata: { periodMonth: existing.periodMonth.toISOString().slice(0, 10) },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ ok: true, status: 'DRAFT' })
}
