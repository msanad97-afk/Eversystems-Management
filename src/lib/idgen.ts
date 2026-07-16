import { Prisma } from '@prisma/client'

/**
 * Transaction-safe human-readable code generator (Part 3 of the spec).
 * Call INSIDE the same prisma.$transaction that creates the record. Postgres
 * row-level locking on the upsert guarantees uniqueness under concurrency.
 *
 *   userCode    = nextCode(tx, 'user',            'USR',          5)  → USR-00001
 *   projectCode = nextCode(tx, `project:${year}`, `PRJ-${year}`,  3)  → PRJ-2026-001
 *   reportCode  = nextCode(tx, `report:${year}`,  `DR-${year}`,   4)  → DR-2026-0001
 */
export async function nextCode(
  tx: Prisma.TransactionClient,
  scope: string,
  prefix: string,
  pad: number,
): Promise<string> {
  const counter = await tx.reportCounter.upsert({
    where: { scope },
    create: { scope, value: 1 },
    update: { value: { increment: 1 } },
  })
  return `${prefix}-${String(counter.value).padStart(pad, '0')}`
}
