import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { isNonEmptyString, parseDate, parseCurrency } from '@/lib/validation'
import { loadCashPosition } from '@/lib/cash.server'

/** Bank accounts with cleared + projected balances, plus company totals. ADMIN-only. */
export async function GET() {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error
  return NextResponse.json(await loadCashPosition())
}

/** Create a bank account. ADMIN-only. */
export async function POST(req: NextRequest) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })

  const name = isNonEmptyString(body.name) ? body.name.trim() : null
  if (!name) return NextResponse.json({ error: 'Account name is required.' }, { status: 400 })

  const currency = parseCurrency(body.currency)
  if (currency === undefined) return NextResponse.json({ error: 'currency must be a 3-letter code (e.g. BHD).' }, { status: 400 })

  const openingBalance = Number(body.openingBalance)
  if (!Number.isFinite(openingBalance)) return NextResponse.json({ error: 'openingBalance must be a number.' }, { status: 400 })

  const openingDate = parseDate(body.openingDate)
  if (!openingDate) return NextResponse.json({ error: 'A valid opening date is required.' }, { status: 400 })

  const created = await prisma.bankAccount.create({
    data: { name, currency, openingBalance, openingDate, createdBy: guard.user.id },
    select: { id: true, name: true },
  })

  writeAuditLog({
    action: 'BANK_ACCOUNT_CREATED',
    userId: guard.user.id,
    entity: 'BankAccount',
    entityId: created.id,
    metadata: { name, currency, openingBalance, openingDate: openingDate.toISOString().slice(0, 10) },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ account: created }, { status: 201 })
}
