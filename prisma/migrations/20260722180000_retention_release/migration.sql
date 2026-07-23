-- Phase 8 — Retention release + valuation recall.
-- Additive: three nullable Project columns (with DB-level defaults for new rows) and one audit
-- enum value. Nothing to backfill.

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'VALUATION_RECALLED';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "defectsLiabilityMonths" INTEGER DEFAULT 12,
ADD COLUMN     "practicalCompletionDate" DATE,
ADD COLUMN     "retentionFirstReleasePct" DECIMAL(5,2) DEFAULT 50;
