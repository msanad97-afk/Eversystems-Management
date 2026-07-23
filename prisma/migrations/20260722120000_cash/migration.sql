-- Phase 6E — Cash.
-- Fully additive. BankAccount and CashTransaction are dormant stubs with zero rows and zero
-- code references before this phase (verified empty at migrate time), so the NOT NULL
-- createdBy / updatedAt columns and the two FK constraints on the already-existing
-- projectId / expenseId columns have nothing to backfill. No reset.

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'VALUATION_INVOICED';
ALTER TYPE "AuditAction" ADD VALUE 'BANK_ACCOUNT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'BANK_ACCOUNT_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'CASH_TXN_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'CASH_TXN_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'CASH_TXN_DELETED';

-- AlterTable
ALTER TABLE "BankAccount" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "createdBy" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "CashTransaction" ADD COLUMN     "clearedAt" DATE,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Valuation" ADD COLUMN     "invoicedAt" DATE;

-- CreateIndex
CREATE INDEX "CashTransaction_valuationId_idx" ON "CashTransaction"("valuationId");

-- CreateIndex
CREATE INDEX "CashTransaction_expenseId_idx" ON "CashTransaction"("expenseId");

-- AddForeignKey
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;
