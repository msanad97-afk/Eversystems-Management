-- Phase 7 — Expense due dates (completes the cash forecast outflow side).
-- Additive: one nullable column, nothing to backfill.

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "dueDate" DATE;
