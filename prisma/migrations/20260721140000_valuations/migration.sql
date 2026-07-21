-- Phase 6D — Valuations (interim payment certificates).
-- Fully additive. The Valuation table is a dormant stub with zero rows and zero code
-- references before this phase, so replacing its unique index and adding NOT NULL columns
-- destroys nothing. No reset.

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'VALUATION_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'VALUATION_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'VALUATION_SUBMITTED';
ALTER TYPE "AuditAction" ADD VALUE 'VALUATION_CERTIFIED';
ALTER TYPE "AuditAction" ADD VALUE 'VALUATION_REISSUED';

-- DropIndex
DROP INDEX "Valuation_projectId_periodMonth_key";

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "lumpsumRevenue" DECIMAL(18,3);

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "retentionCapPct" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "Valuation" ADD COLUMN     "advancePctAtCert" DECIMAL(5,2),
ADD COLUMN     "contractValueAtCert" DECIMAL(18,3),
ADD COLUMN     "cumulativeLumpsum" DECIMAL(18,3) NOT NULL,
ADD COLUMN     "cumulativeMeasured" DECIMAL(18,3) NOT NULL,
ADD COLUMN     "retentionPctAtCert" DECIMAL(5,2),
ADD COLUMN     "revisionNumber" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "supersededAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ValuationLine" (
    "id" TEXT NOT NULL,
    "valuationId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "assetName" TEXT NOT NULL,
    "cumulativeMeasured" DECIMAL(18,3) NOT NULL,
    "cumulativeLumpsum" DECIMAL(18,3) NOT NULL,
    "cumulativeGross" DECIMAL(18,3) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ValuationLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ValuationLine_valuationId_idx" ON "ValuationLine"("valuationId");

-- CreateIndex
CREATE INDEX "Valuation_projectId_periodMonth_idx" ON "Valuation"("projectId", "periodMonth");

-- CreateIndex
CREATE UNIQUE INDEX "Valuation_projectId_periodMonth_revisionNumber_key" ON "Valuation"("projectId", "periodMonth", "revisionNumber");

-- AddForeignKey
ALTER TABLE "ValuationLine" ADD CONSTRAINT "ValuationLine_valuationId_fkey" FOREIGN KEY ("valuationId") REFERENCES "Valuation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
