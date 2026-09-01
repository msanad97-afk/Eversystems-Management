-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('VALUATION_CERTIFIED', 'REPORT_MISSING', 'WEEKLY_SUMMARY');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'NOTIFICATION_RECIPIENT_ADDED';
ALTER TYPE "AuditAction" ADD VALUE 'NOTIFICATION_RECIPIENT_REMOVED';
ALTER TYPE "AuditAction" ADD VALUE 'NOTIFICATION_SENT';

-- CreateTable
CREATE TABLE "NotificationRecipient" (
    "id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "address" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationRecipient_type_idx" ON "NotificationRecipient"("type");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationRecipient_type_address_key" ON "NotificationRecipient"("type", "address");

-- AddForeignKey
ALTER TABLE "NotificationRecipient" ADD CONSTRAINT "NotificationRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
