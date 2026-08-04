-- Stage 1 — Material Requests (request flow).
-- Additive: one new enum, two new tables, four new AuditAction values. No existing table or
-- column is altered and nothing is backfilled. Reviewed requests are immutable at the app
-- layer; the DB keeps quantities only (no cost column) — management cost derives from
-- Material.unitRate at read time.

-- CreateEnum
CREATE TYPE "MaterialRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'MATERIAL_REQUEST_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'MATERIAL_REQUEST_SUBMITTED';
ALTER TYPE "AuditAction" ADD VALUE 'MATERIAL_REQUEST_RECALLED';
ALTER TYPE "AuditAction" ADD VALUE 'MATERIAL_REQUEST_REVIEWED';

-- CreateTable
CREATE TABLE "MaterialRequest" (
    "id" TEXT NOT NULL,
    "requestCode" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "assetId" TEXT,
    "activityId" TEXT,
    "status" "MaterialRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "requestedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialRequestLine" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "requestedQty" DECIMAL(12,3) NOT NULL,
    "approvedQty" DECIMAL(12,3),
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MaterialRequestLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MaterialRequest_requestCode_key" ON "MaterialRequest"("requestCode");

-- CreateIndex
CREATE INDEX "MaterialRequest_projectId_idx" ON "MaterialRequest"("projectId");

-- CreateIndex
CREATE INDEX "MaterialRequest_status_idx" ON "MaterialRequest"("status");

-- CreateIndex
CREATE INDEX "MaterialRequest_requestedById_idx" ON "MaterialRequest"("requestedById");

-- CreateIndex
CREATE INDEX "MaterialRequestLine_materialId_idx" ON "MaterialRequestLine"("materialId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialRequestLine_requestId_materialId_key" ON "MaterialRequestLine"("requestId", "materialId");

-- AddForeignKey
ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequestLine" ADD CONSTRAINT "MaterialRequestLine_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "MaterialRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequestLine" ADD CONSTRAINT "MaterialRequestLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
