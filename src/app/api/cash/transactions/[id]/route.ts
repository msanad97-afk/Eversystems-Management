import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { isNonEmptyString, parseDate } from '@/lib/validation'
import { round } from '@/lib/budget'
import { MONEY_DP } from '@/lib/evm'

const num = (v: unknown): number => (v == null ? 0 : Number(v))

/**
 * Edit a cash transaction — a ledger line is a typo waiting to be corrected, not a frozen
 * document. Supports amount / description / txnDate / clearedAt (set or clear). Category and
 * matching are left immutable here (re-match by delete + re-create) to keep direction and the
 * period link consistent. Audited old→new. ADMIN-only.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const existing = await prisma.cashTransaction.findUnique({
    where: { id: params.id },
    select: { id: true, accountId: true, amount: true, description: true, txnDate: true, clearedAt: true, projectId: true, account: { select: { openingDate: true } } },
  })
  if (!existing) return NextResponse.json({ error: 'Transaction not found.' }, { status: 404 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })

  const data: Record<string, unknown> = {}
  if ('amount' in body) {
    const v = round(Number(body.amount), MONEY_DP)
    if (!Number.isFinite(v) || v <= 0) return NextResponse.json({ error: 'Amount must be greater than 0.' }, { status: 400 })
    data.amount = v
  }
  if (isNonEmptyString(body.description)) data.description = body.description.trim()
  if ('txnDate' in body) {
    const d = parseDate(body.txnDate)
    if (!d) return NextResponse.json({ error: 'txnDate must be a valid date.' }, { status: 400 })
    if (d < existing.account.openingDate) return NextResponse.json({ error: `Transaction date is before the account's opening date (${existing.account.openingDate.toISOString().slice(0, 10)}).` }, { status: 400 })
    data.txnDate = d
  }
  if ('clearedAt' in body) {
    if (body.clearedAt == null || body.clearedAt === '') data.clearedAt = null
    else {
      const d = parseDate(body.clearedAt)
      if (!d) return NextResponse.json({ error: 'clearedAt must be a valid date or empty.' }, { status: 400 })
      data.clearedAt = d
    }
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })

  const changes: Record<string, { from: string | number | null; to: string | number | null }> = {}
  if ('amount' in data) changes.amount = { from: num(existing.amount), to: data.amount as number }
  if ('description' in data) changes.description = { from: existing.description, to: data.description as string }
  if ('txnDate' in data) changes.txnDate = { from: existing.txnDate.toISOString().slice(0, 10), to: (data.txnDate as Date).toISOString().slice(0, 10) }
  if ('clearedAt' in data) changes.clearedAt = { from: existing.clearedAt ? existing.clearedAt.toISOString().slice(0, 10) : null, to: data.clearedAt ? (data.clearedAt as Date).toISOString().slice(0, 10) : null }

  await prisma.cashTransaction.update({ where: { id: existing.id }, data })

  writeAuditLog({
    action: 'CASH_TXN_UPDATED',
    userId: guard.user.id,
    projectId: existing.projectId,
    entity: 'CashTransaction',
    entityId: existing.id,
    metadata: { changes },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ ok: true })
}

/**
 * Hard-delete a cash transaction. The full row goes into the audit metadata so the ledger
 * history survives the deletion. ADMIN-only.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const existing = await prisma.cashTransaction.findUnique({
    where: { id: params.id },
    select: {
      id: true, accountId: true, txnDate: true, direction: true, category: true, amount: true,
      description: true, projectId: true, valuationId: true, expenseId: true, clearedAt: true, createdBy: true, createdAt: true,
    },
  })
  if (!existing) return NextResponse.json({ error: 'Transaction not found.' }, { status: 404 })

  await prisma.cashTransaction.delete({ where: { id: existing.id } })

  writeAuditLog({
    action: 'CASH_TXN_DELETED',
    userId: guard.user.id,
    projectId: existing.projectId,
    entity: 'CashTransaction',
    entityId: existing.id,
    metadata: {
      deleted: {
        accountId: existing.accountId,
        txnDate: existing.txnDate.toISOString().slice(0, 10),
        direction: existing.direction,
        category: existing.category,
        amount: num(existing.amount),
        description: existing.description,
        projectId: existing.projectId,
        valuationId: existing.valuationId,
        expenseId: existing.expenseId,
        clearedAt: existing.clearedAt ? existing.clearedAt.toISOString().slice(0, 10) : null,
        createdBy: existing.createdBy,
        createdAt: existing.createdAt.toISOString(),
      },
    },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ ok: true })
}
