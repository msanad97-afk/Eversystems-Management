-- CreateEnum
CREATE TYPE "ConsumptionSource" AS ENUM ('ACTUAL', 'ESTIMATED', 'COUNT_ADJUSTMENT');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'CONSUMPTION_RECORDED';

-- AlterEnum
ALTER TYPE "InventoryAlertType" ADD VALUE 'MISSING_CONSUMPTION_RATE';

-- CreateTable
CREATE TABLE "ConsumptionEntry" (
    "id" TEXT NOT NULL,
    "dailyReportId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "source" "ConsumptionSource" NOT NULL,
    "estimateRate" DECIMAL(12,4),
    "subActivityReportId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsumptionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsumptionEntry_projectId_materialId_idx" ON "ConsumptionEntry"("projectId", "materialId");

-- CreateIndex
CREATE INDEX "ConsumptionEntry_dailyReportId_idx" ON "ConsumptionEntry"("dailyReportId");

-- AddForeignKey
ALTER TABLE "ConsumptionEntry" ADD CONSTRAINT "ConsumptionEntry_dailyReportId_fkey" FOREIGN KEY ("dailyReportId") REFERENCES "DailyReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumptionEntry" ADD CONSTRAINT "ConsumptionEntry_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsumptionEntry" ADD CONSTRAINT "ConsumptionEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
