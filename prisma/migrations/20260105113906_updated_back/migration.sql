/*
  Warnings:

  - The values [figure,table] on the enum `ContentType` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `caption` on the `building_code_content` table. All the data in the column will be lost.
  - You are about to drop the column `media_data` on the `building_code_content` table. All the data in the column will be lost.
  - You are about to drop the column `media_format` on the `building_code_content` table. All the data in the column will be lost.
  - You are about to drop the column `media_height` on the `building_code_content` table. All the data in the column will be lost.
  - You are about to drop the column `media_type` on the `building_code_content` table. All the data in the column will be lost.
  - You are about to drop the column `media_width` on the `building_code_content` table. All the data in the column will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "ContentType_new" AS ENUM ('division', 'part', 'section', 'subsection', 'article', 'sentence', 'clause', 'subclause', 'see_also', 'definition', 'paragraph', 'note_section', 'note_item', 'note_content', 'list_item');
ALTER TABLE "building_code_content" ALTER COLUMN "contentType" TYPE "ContentType_new" USING ("contentType"::text::"ContentType_new");
ALTER TYPE "ContentType" RENAME TO "ContentType_old";
ALTER TYPE "ContentType_new" RENAME TO "ContentType";
DROP TYPE "public"."ContentType_old";
COMMIT;

-- DropIndex
DROP INDEX "idx_building_code_media_type";

-- AlterTable
ALTER TABLE "building_code_content" DROP COLUMN "caption",
DROP COLUMN "media_data",
DROP COLUMN "media_format",
DROP COLUMN "media_height",
DROP COLUMN "media_type",
DROP COLUMN "media_width";
