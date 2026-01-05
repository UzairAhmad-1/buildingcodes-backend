-- AlterEnum
ALTER TYPE "ContentType" ADD VALUE 'image';

-- AlterTable
ALTER TABLE "building_code_content" ADD COLUMN     "image_data" TEXT,
ADD COLUMN     "image_format" TEXT,
ADD COLUMN     "image_height" INTEGER,
ADD COLUMN     "image_width" INTEGER;
