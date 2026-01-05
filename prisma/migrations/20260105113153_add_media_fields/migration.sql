-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ContentType" ADD VALUE 'figure';
ALTER TYPE "ContentType" ADD VALUE 'table';

-- AlterTable
ALTER TABLE "building_code_content" ADD COLUMN     "caption" TEXT,
ADD COLUMN     "media_data" TEXT,
ADD COLUMN     "media_format" TEXT,
ADD COLUMN     "media_height" INTEGER,
ADD COLUMN     "media_type" TEXT,
ADD COLUMN     "media_width" INTEGER;

-- CreateIndex
CREATE INDEX "idx_building_code_media_type" ON "building_code_content"("media_type");
