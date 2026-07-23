import type { ExpenseCategory } from '@prisma/client'

/**
 * Phase 6B — Actual Cost composition rules (pure).
 *
 * AC = field cost (snapshotted on approved daily reports) + eligible project expenses.
 *
 * Daily reports own labour and site materials, so booking those again as expenses would
 * double-count them. Hence MATERIALS_DIRECT is excluded by default (it is procurement /
 * cash, handled in 6E), and HEAD_OFFICE_OVERHEAD is company-level so it never lands on a
 * project. Expenses with no project are company overhead and never enter a project's AC.
 */

export const AC_ELIGIBLE_CATEGORIES: ExpenseCategory[] = [
  'SUBCONTRACTOR',
  'EQUIPMENT_RENTAL',
  'SALARIES_INDIRECT',
  'SITE_OVERHEAD',
  'OTHER',
]

const EXCLUSION_REASON: Partial<Record<ExpenseCategory, string>> = {
  MATERIALS_DIRECT: 'Materials are costed from daily reports — counting this too would double-count.',
  HEAD_OFFICE_OVERHEAD: 'Company-level overhead — not charged to a single project.',
}

/** Does this expense contribute to its project's Actual Cost? */
export function isExpenseEligibleForAC(category: ExpenseCategory, projectId: string | null): boolean {
  if (!projectId) return false
  return AC_ELIGIBLE_CATEGORIES.includes(category)
}

/** Why an expense is excluded from AC (null when it counts) — shown in the UI, never silent. */
export function expenseExclusionReason(category: ExpenseCategory, projectId: string | null): string | null {
  if (!projectId) return 'Not allocated to a project — company overhead.'
  return EXCLUSION_REASON[category] ?? null
}

export const round3 = (n: number) => Math.round(n * 1000) / 1000
