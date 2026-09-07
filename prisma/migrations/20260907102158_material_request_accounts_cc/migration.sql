-- CreateEnum
CREATE TYPE "EmailRecipientRole" AS ENUM ('TO', 'CC');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'ACCOUNTS';
ALTER TYPE "NotificationType" ADD VALUE 'MATERIAL_REQUEST_MANAGEMENT';

-- AlterTable
ALTER TABLE "EmailRecipient" ADD COLUMN     "role" "EmailRecipientRole" NOT NULL DEFAULT 'TO';
