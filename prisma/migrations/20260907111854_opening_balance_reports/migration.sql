-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'OPENING_REPORT_CREATED';

-- AlterTable
ALTER TABLE "DailyReport" ADD COLUMN     "isOpeningBalance" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ReportActivity" ADD COLUMN     "openingLabourCost" DECIMAL(18,3);
