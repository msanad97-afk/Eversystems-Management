-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'ACTIVITY_REPRICED';

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "lumpsumBillBhd" DECIMAL(18,3),
ADD COLUMN     "pricedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CatalogActivity" ADD COLUMN     "lumpsumBillBhd" DECIMAL(18,3);

-- AlterTable
ALTER TABLE "CatalogSubActivity" ADD COLUMN     "lumpsumBillBhd" DECIMAL(18,3);

-- AlterTable
ALTER TABLE "SubActivity" ADD COLUMN     "lumpsumBillBhd" DECIMAL(18,3);

-- AlterTable
ALTER TABLE "SubActivityManpowerBudget" ADD COLUMN     "costRateAtPlacement" DECIMAL(10,3);

-- AlterTable
ALTER TABLE "SubActivityMaterialBudget" ADD COLUMN     "costRateAtPlacement" DECIMAL(12,3);

