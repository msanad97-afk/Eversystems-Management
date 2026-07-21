-- Phase 6C: Earned Value Management.
-- Only two schema changes: the baseline column rename, and one audit action.

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'BASELINE_UPDATED';

-- AlterTable: rename (NOT drop+add) so any existing baseline data survives.
-- BaselinePeriod.plannedPct held the same 0–100 cumulative percent; only the name changes
-- to state explicitly that it is CUMULATIVE planned % of BAC by month-end.
ALTER TABLE "BaselinePeriod" RENAME COLUMN "plannedPct" TO "cumPlannedPct";
