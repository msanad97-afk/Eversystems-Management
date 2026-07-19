-- CreateEnum
CREATE TYPE "LineType" AS ENUM ('MEASURED', 'LUMPSUM');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'CATALOG_ACTIVITY_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'CATALOG_ACTIVITY_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'CATALOG_ACTIVITY_DELETED';
ALTER TYPE "AuditAction" ADD VALUE 'ACTIVITY_PLACED_FROM_CATALOG';

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "catalogActivityId" TEXT,
ADD COLUMN     "lumpsumBhd" DECIMAL(18,3),
ADD COLUMN     "type" "LineType" NOT NULL DEFAULT 'MEASURED',
ALTER COLUMN "unit" DROP NOT NULL;

-- AlterTable
ALTER TABLE "BankAccount" ALTER COLUMN "openingBalance" SET DATA TYPE DECIMAL(18,3);

-- AlterTable
ALTER TABLE "CashTransaction" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(18,3);

-- AlterTable
ALTER TABLE "Expense" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(18,3);

-- AlterTable
ALTER TABLE "Project" ALTER COLUMN "contractValue" SET DATA TYPE DECIMAL(18,3),
ALTER COLUMN "budgetCost" SET DATA TYPE DECIMAL(18,3);

-- AlterTable
ALTER TABLE "Valuation" ALTER COLUMN "grossAmount" SET DATA TYPE DECIMAL(18,3),
ALTER COLUMN "previousGross" SET DATA TYPE DECIMAL(18,3),
ALTER COLUMN "retentionHeld" SET DATA TYPE DECIMAL(18,3),
ALTER COLUMN "advanceRecovery" SET DATA TYPE DECIMAL(18,3),
ALTER COLUMN "netPayable" SET DATA TYPE DECIMAL(18,3);

-- CreateTable
CREATE TABLE "CatalogActivity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LineType" NOT NULL DEFAULT 'MEASURED',
    "unit" TEXT,
    "lumpsumBhd" DECIMAL(18,3),
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogSubActivity" (
    "id" TEXT NOT NULL,
    "catalogActivityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LineType" NOT NULL DEFAULT 'MEASURED',
    "lumpsumBhd" DECIMAL(18,3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isImplicit" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CatalogSubActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogManpowerRate" (
    "id" TEXT NOT NULL,
    "catalogSubActivityId" TEXT NOT NULL,
    "laborCategoryId" TEXT NOT NULL,
    "hoursPerUnit" DECIMAL(10,4) NOT NULL,

    CONSTRAINT "CatalogManpowerRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogMaterialRate" (
    "id" TEXT NOT NULL,
    "catalogSubActivityId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "qtyPerUnit" DECIMAL(12,4) NOT NULL,

    CONSTRAINT "CatalogMaterialRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubActivity" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LineType" NOT NULL DEFAULT 'MEASURED',
    "lumpsumBhd" DECIMAL(18,3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isImplicit" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubActivityManpowerBudget" (
    "id" TEXT NOT NULL,
    "subActivityId" TEXT NOT NULL,
    "laborCategoryId" TEXT NOT NULL,
    "hoursPerUnit" DECIMAL(10,4) NOT NULL,

    CONSTRAINT "SubActivityManpowerBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubActivityMaterialBudget" (
    "id" TEXT NOT NULL,
    "subActivityId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "qtyPerUnit" DECIMAL(12,4) NOT NULL,

    CONSTRAINT "SubActivityMaterialBudget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogActivity_name_key" ON "CatalogActivity"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogSubActivity_catalogActivityId_name_key" ON "CatalogSubActivity"("catalogActivityId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogManpowerRate_catalogSubActivityId_laborCategoryId_key" ON "CatalogManpowerRate"("catalogSubActivityId", "laborCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogMaterialRate_catalogSubActivityId_materialId_key" ON "CatalogMaterialRate"("catalogSubActivityId", "materialId");

-- CreateIndex
CREATE INDEX "SubActivity_activityId_idx" ON "SubActivity"("activityId");

-- CreateIndex
CREATE UNIQUE INDEX "SubActivity_activityId_name_key" ON "SubActivity"("activityId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SubActivityManpowerBudget_subActivityId_laborCategoryId_key" ON "SubActivityManpowerBudget"("subActivityId", "laborCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "SubActivityMaterialBudget_subActivityId_materialId_key" ON "SubActivityMaterialBudget"("subActivityId", "materialId");

-- CreateIndex
CREATE INDEX "Activity_catalogActivityId_idx" ON "Activity"("catalogActivityId");

-- AddForeignKey
ALTER TABLE "CatalogSubActivity" ADD CONSTRAINT "CatalogSubActivity_catalogActivityId_fkey" FOREIGN KEY ("catalogActivityId") REFERENCES "CatalogActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogManpowerRate" ADD CONSTRAINT "CatalogManpowerRate_catalogSubActivityId_fkey" FOREIGN KEY ("catalogSubActivityId") REFERENCES "CatalogSubActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogManpowerRate" ADD CONSTRAINT "CatalogManpowerRate_laborCategoryId_fkey" FOREIGN KEY ("laborCategoryId") REFERENCES "LaborCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogMaterialRate" ADD CONSTRAINT "CatalogMaterialRate_catalogSubActivityId_fkey" FOREIGN KEY ("catalogSubActivityId") REFERENCES "CatalogSubActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogMaterialRate" ADD CONSTRAINT "CatalogMaterialRate_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_catalogActivityId_fkey" FOREIGN KEY ("catalogActivityId") REFERENCES "CatalogActivity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubActivity" ADD CONSTRAINT "SubActivity_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubActivityManpowerBudget" ADD CONSTRAINT "SubActivityManpowerBudget_subActivityId_fkey" FOREIGN KEY ("subActivityId") REFERENCES "SubActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubActivityManpowerBudget" ADD CONSTRAINT "SubActivityManpowerBudget_laborCategoryId_fkey" FOREIGN KEY ("laborCategoryId") REFERENCES "LaborCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubActivityMaterialBudget" ADD CONSTRAINT "SubActivityMaterialBudget_subActivityId_fkey" FOREIGN KEY ("subActivityId") REFERENCES "SubActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubActivityMaterialBudget" ADD CONSTRAINT "SubActivityMaterialBudget_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

