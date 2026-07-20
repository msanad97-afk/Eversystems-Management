import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { isNonEmptyString, parseDate } from '@/lib/validation'
import { isExpenseCategory, serializeExpense, expenseSelect } from '@/lib/expenses'

/** Freely editable in 6B (audited); period-locking arrives with certification in 6D. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const existing = await prisma.expense.findUnique({ where: { id: params.id }, select: { id: true, projectId: true } })
  if (!existing) return NextResponse.json({ error: 'Expense not found.' }, { status: 404 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })

  const data: Record<string, unknown> = {}
  if (isNonEmptyString(body.description)) data.description = body.description.trim()
  if ('vendor' in body) data.vendor = isNonEmptyString(body.vendor) ? body.vendor.trim() : null
  if ('amount' in body) {
    const amount = Number(body.amount)
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'Amount must be greater than 0.' }, { status: 400 })
    data.amount = amount
  }
  if ('expenseDate' in body) {
    const d = parseDate(body.expenseDate)
    if (!d) return NextResponse.json({ error: 'A valid expense date is required.' }, { status: 400 })
    data.expenseDate = d
  }
  if ('category' in body) {
    if (!isExpenseCategory(body.category)) return NextResponse.json({ error: 'A valid category is required.' }, { status: 400 })
    data.category = body.category
  }
  if ('projectId' in body) {
    const pid = isNonEmptyString(body.projectId) ? body.projectId : null
    if (pid && !(await prisma.project.findUnique({ where: { id: pid }, select: { id: true } }))) {
      return NextResponse.json({ error: 'Project not found.' }, { status: 400 })
    }
    data.projectId = pid
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })

  const updated = await prisma.expense.update({ where: { id: params.id }, data, select: expenseSelect })

  writeAuditLog({
    action: 'EXPENSE_UPDATED',
    userId: guard.user.id,
    projectId: updated.projectId,
    entity: 'Expense',
    entityId: updated.id,
    metadata: { fields: Object.keys(data) },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ expense: serializeExpense(updated) })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const existing = await prisma.expense.findUnique({
    where: { id: params.id },
    select: { id: true, projectId: true, description: true, amount: true, category: true },
  })
  if (!existing) return NextResponse.json({ error: 'Expense not found.' }, { status: 404 })

  await prisma.expense.delete({ where: { id: params.id } })

  writeAuditLog({
    action: 'EXPENSE_DELETED',
    userId: guard.user.id,
    projectId: existing.projectId,
    entity: 'Expense',
    entityId: existing.id,
    metadata: { description: existing.description, amount: Number(existing.amount), category: existing.category },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ ok: true })
}
