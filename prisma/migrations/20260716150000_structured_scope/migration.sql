-- AlterEnum (PostgreSQL 16 — multiple ADD VALUE in one migration is supported)
ALTER TYPE "AuditAction" ADD VALUE 'ASSET_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'ASSET_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'ACTIVITY_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'ACTIVITY_UPDATED';

-- DropForeignKey
ALTER TABLE "ManpowerEntry" DROP CONSTRAINT "ManpowerEntry_reportId_fkey";

-- DropForeignKey
ALTER TABLE "MaterialEntry" DROP CONSTRAINT "MaterialEntry_reportId_fkey";

-- DropForeignKey
ALTER TABLE "WorkItem" DROP CONSTRAINT "WorkItem_reportId_fkey";

-- DropIndex
DROP INDEX "ManpowerEntry_reportId_categoryId_key";

-- DropIndex
DROP INDEX "MaterialEntry_reportId_materialId_key";

-- AlterTable
ALTER TABLE "ManpowerEntry" DROP COLUMN "reportId",
ADD COLUMN     "reportActivityId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "MaterialEntry" DROP COLUMN "reportId",
ADD COLUMN     "reportActivityId" TEXT NOT NULL;

-- DropTable
DROP TABLE "WorkItem";

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ref" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "ref" TEXT,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "boqQuantity" DECIMAL(14,3) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "costRate" DECIMAL(14,3),
    "billRate" DECIMAL(14,3),

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportActivity" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "quantityDone" DECIMAL(14,3) NOT NULL,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReportActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Asset_projectId_idx" ON "Asset"("projectId");

-- CreateIndex
CREATE INDEX "Activity_assetId_idx" ON "Activity"("assetId");

-- CreateIndex
CREATE INDEX "ReportActivity_activityId_idx" ON "ReportActivity"("activityId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportActivity_reportId_activityId_key" ON "ReportActivity"("reportId", "activityId");

-- CreateIndex
CREATE UNIQUE INDEX "ManpowerEntry_reportActivityId_categoryId_key" ON "ManpowerEntry"("reportActivityId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialEntry_reportActivityId_materialId_key" ON "MaterialEntry"("reportActivityId", "materialId");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportActivity" ADD CONSTRAINT "ReportActivity_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "DailyReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportActivity" ADD CONSTRAINT "ReportActivity_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManpowerEntry" ADD CONSTRAINT "ManpowerEntry_reportActivityId_fkey" FOREIGN KEY ("reportActivityId") REFERENCES "ReportActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialEntry" ADD CONSTRAINT "MaterialEntry_reportActivityId_fkey" FOREIGN KEY ("reportActivityId") REFERENCES "ReportActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
