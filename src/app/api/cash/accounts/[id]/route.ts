import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { isNonEmptyString, parseDate } from '@/lib/validation'

/**
 * Edit a bank account — name, isActive, opening figures. An opening-date change that would
 * strand transactions dated before it is rejected (they belong to the opening balance).
 * Audited old→new. ADMIN-only.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const account = await prisma.bankAccount.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, isActive: true, openingBalance: true, openingDate: true },
  })
  if (!account) return NextResponse.json({ error: 'Account not found.' }, { status: 404 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })

  const data: Record<string, unknown> = {}
  if (isNonEmptyString(body.name)) data.name = body.name.trim()
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive
  if ('openingBalance' in body) {
    const v = Number(body.openingBalance)
    if (!Number.isFinite(v)) return NextResponse.json({ error: 'openingBalance must be a number.' }, { status: 400 })
    data.openingBalance = v
  }
  if ('openingDate' in body) {
    const d = parseDate(body.openingDate)
    if (!d) return NextResponse.json({ error: 'openingDate must be a valid date.' }, { status: 400 })
    // A later opening date must not strand existing transactions before it.
    const stranded = await prisma.cashTransaction.count({ where: { accountId: account.id, txnDate: { lt: d } } })
    if (stranded > 0) {
      return NextResponse.json(
        { error: `Cannot move the opening date later than ${stranded} existing transaction(s). Move or delete them first.` },
        { status: 409 },
      )
    }
    data.openingDate = d
  }

  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })

  const num = (v: unknown): number | null => (v == null ? null : Number(v))
  const changes: Record<string, { from: string | number | boolean | null; to: string | number | boolean | null }> = {}
  if ('name' in data) changes.name = { from: account.name, to: data.name as string }
  if ('isActive' in data) changes.isActive = { from: account.isActive, to: data.isActive as boolean }
  if ('openingBalance' in data) changes.openingBalance = { from: num(account.openingBalance), to: data.openingBalance as number }
  if ('openingDate' in data) changes.openingDate = { from: account.openingDate.toISOString().slice(0, 10), to: (data.openingDate as Date).toISOString().slice(0, 10) }

  await prisma.bankAccount.update({ where: { id: account.id }, data })

  writeAuditLog({
    action: 'BANK_ACCOUNT_UPDATED',
    userId: guard.user.id,
    entity: 'BankAccount',
    entityId: account.id,
    metadata: { changes },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ ok: true })
}
