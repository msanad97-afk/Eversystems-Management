import type { MaterialRequestStatus } from '@prisma/client'

/**
 * Material-request lifecycle (Stage 1). Mirrors the daily-report approval shape but a
 * REVIEWED request is TERMINAL — no resubmit; a correction is a brand-new request.
 *
 *   DRAFT → SUBMITTED → (APPROVED | PARTIALLY_APPROVED | REJECTED)   [terminal]
 *   SUBMITTED → DRAFT   (author recall, before review)
 */

/** An author may edit (PATCH) only a DRAFT request. */
export function canEditRequest(status: MaterialRequestStatus): boolean {
  return status === 'DRAFT'
}
/** An author may submit only a DRAFT request. */
export function canSubmitRequest(status: MaterialRequestStatus): boolean {
  return status === 'DRAFT'
}
/** An author may recall a SUBMITTED request back to DRAFT before it is reviewed. */
export function canRecallRequest(status: MaterialRequestStatus): boolean {
  return status === 'SUBMITTED'
}
/** An admin may review only a SUBMITTED request. */
export function canReviewRequest(status: MaterialRequestStatus): boolean {
  return status === 'SUBMITTED'
}
/** A reviewed request is immutable. */
export function isReviewed(status: MaterialRequestStatus): boolean {
  return status === 'APPROVED' || status === 'PARTIALLY_APPROVED' || status === 'REJECTED'
}

// ─── Create / edit validation ─────────────────────────────────────────────────

export interface RequestLineInput {
  materialId: string
  requestedQty: number
  note?: string | null
}

/** Validate the lines a supervisor submits: at least one, each material once, qty > 0. */
export function validateRequestLines(lines: RequestLineInput[]): string | null {
  if (lines.length === 0) return 'Add at least one material line.'
  const seen = new Set<string>()
  for (const l of lines) {
    if (!l.materialId) return 'Each line needs a material.'
    if (seen.has(l.materialId)) return 'A material can appear only once per request.'
    seen.add(l.materialId)
    if (!(l.requestedQty > 0)) return 'Each requested quantity must be greater than zero.'
  }
  return null
}

// ─── Review resolution ────────────────────────────────────────────────────────

export interface ReviewLine {
  requestedQty: number
  approvedQty: number // >= 0; 0 = line rejected
}

/**
 * Overall status from per-line decisions:
 *   - every line approved in full (approved === requested) → APPROVED
 *   - every line rejected (approved 0)                     → REJECTED
 *   - anything else (some modified or some rejected)       → PARTIALLY_APPROVED
 */
export function resolveReviewStatus(
  lines: ReviewLine[],
): 'APPROVED' | 'PARTIALLY_APPROVED' | 'REJECTED' {
  if (lines.length === 0) return 'REJECTED'
  if (lines.every((l) => l.approvedQty === l.requestedQty)) return 'APPROVED'
  if (lines.every((l) => l.approvedQty === 0)) return 'REJECTED'
  return 'PARTIALLY_APPROVED'
}

/** Validate a review decision quantity: a real number ≥ 0 (0 = reject; never negative). */
export function validateApprovedQty(qty: unknown): qty is number {
  return typeof qty === 'number' && Number.isFinite(qty) && qty >= 0
}
