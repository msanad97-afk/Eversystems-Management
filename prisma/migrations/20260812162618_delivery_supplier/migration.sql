-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "supplierId" TEXT;

-- CreateIndex
CREATE INDEX "Delivery_supplierId_idx" ON "Delivery"("supplierId");

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
