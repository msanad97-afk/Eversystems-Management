-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'EXPENSE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'EXPENSE_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'EXPENSE_DELETED';
ALTER TYPE "AuditAction" ADD VALUE 'REPORT_COST_BACKFILLED';

-- AlterTable
ALTER TABLE "DailyReport" ADD COLUMN     "costBackfilledAt" TIMESTAMP(3);

