-- Correctness fix: a lumpsum is a COST, not revenue.
--
-- Phase 6A modelled an activity/sub-activity lumpsum as carrying its own contract value,
-- defaulting to cost ("bill defaults to cost"). That is wrong for this business: billing
-- happens at asset/project level, never on an activity line. A lumpsum raises the cost
-- budget (BAC) and contributes ZERO to contract value.
--
-- The lumpsumBillBhd columns are therefore dropped. Nothing ever populated the two catalog
-- columns (the catalog payload parser never read the field), and the concept itself is being
-- removed as incorrect, so any values that did exist encoded the wrong model.

-- New audit action for hard-deleting an unused project activity.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ACTIVITY_DELETED';

ALTER TABLE "Activity" DROP COLUMN IF EXISTS "lumpsumBillBhd";
ALTER TABLE "SubActivity" DROP COLUMN IF EXISTS "lumpsumBillBhd";
ALTER TABLE "CatalogActivity" DROP COLUMN IF EXISTS "lumpsumBillBhd";
ALTER TABLE "CatalogSubActivity" DROP COLUMN IF EXISTS "lumpsumBillBhd";
