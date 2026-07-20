-- DropForeignKey
ALTER TABLE "ManpowerEntry" DROP CONSTRAINT "ManpowerEntry_reportActivityId_fkey";

-- DropForeignKey
ALTER TABLE "MaterialEntry" DROP CONSTRAINT "MaterialEntry_reportActivityId_fkey";

-- DropIndex
DROP INDEX "ManpowerEntry_reportActivityId_categoryId_key";

-- DropIndex
DROP INDEX "MaterialEntry_reportActivityId_materialId_key";

-- AlterTable
ALTER TABLE "ManpowerEntry" DROP COLUMN "reportActivityId",
ADD COLUMN     "reportSubActivityId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "MaterialEntry" DROP COLUMN "reportActivityId",
ADD COLUMN     "reportSubActivityId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ReportActivity" DROP COLUMN "quantityDone";

-- CreateTable
CREATE TABLE "ReportSubActivity" (
    "id" TEXT NOT NULL,
    "reportActivityId" TEXT NOT NULL,
    "subActivityId" TEXT NOT NULL,
    "quantityDone" DECIMAL(14,3),
    "percentComplete" DECIMAL(6,3),
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReportSubActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportSubActivity_subActivityId_idx" ON "ReportSubActivity"("subActivityId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportSubActivity_reportActivityId_subActivityId_key" ON "ReportSubActivity"("reportActivityId", "subActivityId");

-- CreateIndex
CREATE UNIQUE INDEX "ManpowerEntry_reportSubActivityId_categoryId_key" ON "ManpowerEntry"("reportSubActivityId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialEntry_reportSubActivityId_materialId_key" ON "MaterialEntry"("reportSubActivityId", "materialId");

-- AddForeignKey
ALTER TABLE "ReportSubActivity" ADD CONSTRAINT "ReportSubActivity_reportActivityId_fkey" FOREIGN KEY ("reportActivityId") REFERENCES "ReportActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSubActivity" ADD CONSTRAINT "ReportSubActivity_subActivityId_fkey" FOREIGN KEY ("subActivityId") REFERENCES "SubActivity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManpowerEntry" ADD CONSTRAINT "ManpowerEntry_reportSubActivityId_fkey" FOREIGN KEY ("reportSubActivityId") REFERENCES "ReportSubActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialEntry" ADD CONSTRAINT "MaterialEntry_reportSubActivityId_fkey" FOREIGN KEY ("reportSubActivityId") REFERENCES "ReportSubActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

