import { NextResponse, type NextRequest } from 'next/server'
import { CashCategory } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { isNonEmptyString, parseDate } from '@/lib/validation'
import { directionFor } from '@/lib/cash'
import { loadLedger, resolveValuationMatch, type LedgerFilters } from '@/lib/cash.server'
import { round } from '@/lib/budget'
import { MONEY_DP } from '@/lib/evm'

function isCashCategory(v: unknown): v is CashCategory {
  return typeof v === 'string' && (Object.values(CashCategory) as string[]).includes(v)
}
const utcDay = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) }

/** Filterable, paginated cash ledger. ADMIN-only. */
export async function GET(req: NextRequest) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const sp = req.nextUrl.searchParams
  const limit = Math.min(Math.max(Number(sp.get('limit')) || 50, 1), 200)
  const offset = Math.max(Number(sp.get('offset')) || 0, 0)
  const cleared = sp.get('cleared')
  const matched = sp.get('matched')

  const filters: LedgerFilters = {
    accountId: sp.get('accountId') ?? undefined,
    projectId: sp.get('projectId') ?? undefined,
    direction: sp.get('direction') === 'IN' || sp.get('direction') === 'OUT' ? (sp.get('direction') as 'IN' | 'OUT') : undefined,
    category: isCashCategory(sp.get('category')) ? (sp.get('category') as CashCategory) : undefined,
    from: parseDate(sp.get('from')) ?? undefined,
    to: parseDate(sp.get('to')) ?? undefined,
    cleared: cleared === 'true' ? true : cleared === 'false' ? false : undefined,
    matched: matched === 'true' ? true : matched === 'false' ? false : undefined,
    limit,
    offset,
  }

  return NextResponse.json(await loadLedger(filters))
}

/**
 * Record a cash movement. `direction` is derived from `category` (a client-supplied direction
 * is ignored). Enforces the §6E.7 rules: amount > 0, dated on/after the account's opening date,
 * at most one of valuation/expense, a valuation match must be CERTIFIED with projectId taken
 * from it, single-currency, and the over-payment guard (flag, not hard block). ADMIN-only.
 */
export async function POST(req: NextRequest) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })

  if (!isCashCategory(body.category)) return NextResponse.json({ error: 'A valid category is required.' }, { status: 400 })
  const category = body.category as CashCategory
  const direction = directionFor(category) // derived, never from the client

  const amount = round(Number(body.amount), MONEY_DP)
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'Amount must be greater than 0.' }, { status: 400 })

  const description = isNonEmptyString(body.description) ? body.description.trim() : null
  if (!description) return NextResponse.json({ error: 'A description is required.' }, { status: 400 })

  const txnDate = parseDate(body.txnDate)
  if (!txnDate) return NextResponse.json({ error: 'A valid transaction date is required.' }, { status: 400 })

  const account = await prisma.bankAccount.findUnique({ where: { id: body.accountId }, select: { id: true, currency: true, openingDate: true } })
  if (!account) return NextResponse.json({ error: 'Bank account not found.' }, { status: 400 })
  if (txnDate < account.openingDate) {
    return NextResponse.json({ error: `Transaction date is before the account's opening date (${account.openingDate.toISOString().slice(0, 10)}); it belongs to the opening balance.` }, { status: 400 })
  }

  const clearedAt = body.clearedAt == null || body.clearedAt === '' ? null : parseDate(body.clearedAt)
  if (body.clearedAt && !clearedAt) return NextResponse.json({ error: 'clearedAt must be a valid date or empty.' }, { status: 400 })

  // ── matching: at most one of valuation / expense ──
  const hasVal = isNonEmptyString(body.valuationId)
  const hasExp = isNonEmptyString(body.expenseId)
  if (hasVal && hasExp) return NextResponse.json({ error: 'A transaction can match a valuation OR an expense, not both.' }, { status: 400 })

  let projectId: string | null = isNonEmptyString(body.projectId) ? body.projectId : null
  let valuationId: string | null = null
  let expenseId: string | null = null

  if (hasVal) {
    if (direction !== 'IN') return NextResponse.json({ error: 'Only an inflow can be matched to a valuation.' }, { status: 400 })
    const match = await resolveValuationMatch(body.valuationId, utcDay())
    if (!match.ok) return NextResponse.json({ error: match.error }, { status: 400 })
    valuationId = body.valuationId
    projectId = match.projectId // taken from the valuation, never free-typed

    // Over-payment guard — a flag, not a hard block (§6E.7).
    if (amount > match.ctx.periodOutstandingBefore && body.allowOverpay !== true) {
      return NextResponse.json(
        {
          error: `This receipt (${amount}) exceeds the period's outstanding (${match.ctx.periodOutstandingBefore}). Confirm to record an over-payment.`,
          outstanding: match.ctx.periodOutstandingBefore,
          requiresOverpayConfirm: true,
        },
        { status: 409 },
      )
    }
  } else if (hasExp) {
    const expense = await prisma.expense.findUnique({ where: { id: body.expenseId }, select: { id: true, projectId: true } })
    if (!expense) return NextResponse.json({ error: 'Matched expense not found.' }, { status: 400 })
    expenseId = body.expenseId
    if (expense.projectId) projectId = expense.projectId
  }

  // ── single-currency guard: a linked project's currency must match the account's ──
  if (projectId) {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { currency: true } })
    if (!project) return NextResponse.json({ error: 'Linked project not found.' }, { status: 400 })
    if (project.currency !== account.currency) {
      return NextResponse.json({ error: `Currency mismatch: the account is ${account.currency} but the project is ${project.currency}. Multi-currency is not supported.` }, { status: 400 })
    }
  }

  const created = await prisma.cashTransaction.create({
    data: { accountId: account.id, txnDate, direction, category, amount, description, projectId, valuationId, expenseId, clearedAt, createdBy: guard.user.id },
    select: { id: true },
  })

  writeAuditLog({
    action: 'CASH_TXN_CREATED',
    userId: guard.user.id,
    projectId,
    entity: 'CashTransaction',
    entityId: created.id,
    metadata: { category, direction, amount, txnDate: txnDate.toISOString().slice(0, 10), valuationId, expenseId, cleared: clearedAt != null },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ transaction: created }, { status: 201 })
}
