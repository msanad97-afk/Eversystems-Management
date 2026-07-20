import { ExpenseCategory } from '@prisma/client'
import { isExpenseEligibleForAC, expenseExclusionReason } from '@/lib/cost'

export function isExpenseCategory(v: unknown): v is ExpenseCategory {
  return typeof v === 'string' && (Object.values(ExpenseCategory) as string[]).includes(v)
}

export interface ExpenseRow {
  id: string
  category: ExpenseCategory
  description: string
  vendor: string | null
  expenseDate: Date
  amount: unknown
  projectId: string | null
  project?: { name: string } | null
}

export const expenseSelect = {
  id: true,
  category: true,
  description: true,
  vendor: true,
  expenseDate: true,
  amount: true,
  projectId: true,
  project: { select: { name: true } },
} as const

/** Serialized with its AC eligibility + the reason when excluded, so the UI never guesses. */
export function serializeExpense(e: ExpenseRow) {
  return {
    id: e.id,
    category: e.category,
    description: e.description,
    vendor: e.vendor,
    expenseDate: e.expenseDate.toISOString().slice(0, 10),
    amount: Number(e.amount),
    projectId: e.projectId,
    projectName: e.project?.name ?? null,
    eligible: isExpenseEligibleForAC(e.category, e.projectId),
    exclusionReason: expenseExclusionReason(e.category, e.projectId),
  }
}
