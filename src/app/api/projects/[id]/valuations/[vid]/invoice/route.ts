import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'

/**
 * Mark a certified valuation as invoiced (or clear it with { invoiced: false }). This sets the
 * stored `invoicedAt` — the ONE manual payment-side step. It deliberately does NOT touch
 * `status`: advancing a certificate to INVOICED/PAID would drop it from the certified-period
 * lookups and silently re-bill it (§6E.1). Payment state is derived, not a status transition.
 * ADMIN-only.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string; vid: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const existing = await prisma.valuation.findFirst({
    where: { id: params.vid, projectId: params.id },
    select: { id: true, valuationCode: true, status: true, invoicedAt: true, periodMonth: true },
  })
  if (!existing) return NextResponse.json({ error: 'Valuation not found.' }, { status: 404 })
  if (existing.status !== 'CERTIFIED') {
    return NextResponse.json({ error: `Only a CERTIFIED valuation can be invoiced (this one is ${existing.status}).` }, { status: 409 })
  }

  const body = (await req.json().catch(() => null)) ?? {}
  const invoiced = body.invoiced !== false // default: mark invoiced; pass { invoiced: false } to clear
  const invoicedAt = invoiced ? new Date() : null

  await prisma.valuation.update({ where: { id: existing.id }, data: { invoicedAt } })

  writeAuditLog({
    action: 'VALUATION_INVOICED',
    userId: guard.user.id,
    projectId: params.id,
    entity: 'Valuation',
    entityId: existing.id,
    entityCode: existing.valuationCode,
    metadata: {
      periodMonth: existing.periodMonth.toISOString().slice(0, 10),
      invoiced,
      from: existing.invoicedAt ? existing.invoicedAt.toISOString().slice(0, 10) : null,
      to: invoicedAt ? invoicedAt.toISOString().slice(0, 10) : null,
    },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ ok: true, invoicedAt: invoicedAt ? invoicedAt.toISOString().slice(0, 10) : null })
}
