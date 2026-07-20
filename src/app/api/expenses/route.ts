import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth/permissions'
import { writeAuditLog } from '@/lib/audit'
import { getClientIp } from '@/lib/request'
import { isNonEmptyString, parseDate } from '@/lib/validation'
import { isExpenseCategory, serializeExpense, expenseSelect } from '@/lib/expenses'

/** Expenses are money — ADMIN only, consistent with every other financial surface. */
export async function GET(req: NextRequest) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const projectId = req.nextUrl.searchParams.get('projectId')
  const expenses = await prisma.expense.findMany({
    where: projectId ? { projectId } : undefined,
    orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
    select: expenseSelect,
  })
  return NextResponse.json({ expenses: expenses.map(serializeExpense) })
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin()
  if ('error' in guard) return guard.error

  const body = await req.json().catch(() => null)
  const description = isNonEmptyString(body?.description) ? body.description.trim() : null
  const amount = Number(body?.amount)
  const expenseDate = parseDate(body?.expenseDate)
  if (!description) return NextResponse.json({ error: 'Description is required.' }, { status: 400 })
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'Amount must be greater than 0.' }, { status: 400 })
  if (!expenseDate) return NextResponse.json({ error: 'A valid expense date is required.' }, { status: 400 })
  if (!isExpenseCategory(body?.category)) return NextResponse.json({ error: 'A valid category is required.' }, { status: 400 })

  // projectId is optional: null = company-level overhead (never enters a project's AC).
  const projectId = isNonEmptyString(body?.projectId) ? body.projectId : null
  if (projectId && !(await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } }))) {
    return NextResponse.json({ error: 'Project not found.' }, { status: 400 })
  }

  const created = await prisma.expense.create({
    data: {
      description, amount, expenseDate, category: body.category, projectId,
      vendor: isNonEmptyString(body?.vendor) ? body.vendor.trim() : null,
      createdBy: guard.user.id,
    },
    select: expenseSelect,
  })

  writeAuditLog({
    action: 'EXPENSE_CREATED',
    userId: guard.user.id,
    projectId,
    entity: 'Expense',
    entityId: created.id,
    metadata: { category: body.category, amount, description },
    ipAddress: getClientIp(req),
  })

  return NextResponse.json({ expense: serializeExpense(created) }, { status: 201 })
}
