import type { AuditAction, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export interface AuditLogInput {
  action: AuditAction
  userId?: string | null
  projectId?: string | null
  entity?: string | null
  entityId?: string | null
  entityCode?: string | null
  metadata?: Prisma.InputJsonValue
  ipAddress?: string | null
}

/**
 * Fire-and-forget audit logger (inherited pattern). Never throws into the caller:
 * an audit-write failure must not break the business operation it records. Rows
 * are immutable — nothing in the app ever updates or deletes an AuditLog.
 */
function toData(input: AuditLogInput) {
  return {
    action: input.action,
    userId: input.userId ?? null,
    projectId: input.projectId ?? null,
    entity: input.entity ?? null,
    entityId: input.entityId ?? null,
    entityCode: input.entityCode ?? null,
    metadata: input.metadata,
    ipAddress: input.ipAddress ?? null,
  }
}

export function writeAuditLog(input: AuditLogInput): void {
  prisma.auditLog.create({ data: toData(input) }).catch((err) => {
    // Log locally; do not propagate.
    console.error('[audit] failed to write audit log', input.action, err)
  })
}

/**
 * Awaited audit write. Used where a later decision depends on the row already being
 * persisted — notably login-failure records that feed the rate limiter. Still swallows
 * errors so it never breaks the calling flow.
 */
export async function recordAuditLog(input: AuditLogInput): Promise<void> {
  try {
    await prisma.auditLog.create({ data: toData(input) })
  } catch (err) {
    console.error('[audit] failed to write audit log', input.action, err)
  }
}
