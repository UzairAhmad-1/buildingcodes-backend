-- CreateEnum
CREATE TYPE "ContentType" AS ENUM ('division', 'part', 'section', 'subsection', 'article', 'sentence', 'clause', 'subclause');

-- CreateTable
CREATE TABLE "admins" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jurisdictions" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jurisdictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_types" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "languages" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "languages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pdf_documents" (
    "id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "original_file_name" TEXT NOT NULL,
    "file_size" BIGINT,
    "title" TEXT NOT NULL,
    "year" INTEGER,
    "version" TEXT,
    "effective_date" TIMESTAMP(3),
    "processing_status" TEXT NOT NULL DEFAULT 'pending',
    "processed_at" TIMESTAMP(3),
    "file_path" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "jurisdiction_id" INTEGER,
    "document_type_id" INTEGER,
    "language_id" INTEGER,

    CONSTRAINT "pdf_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "building_code_content" (
    "id" SERIAL NOT NULL,
    "parent_id" INTEGER,
    "contentType" "ContentType" NOT NULL,
    "page_number" INTEGER,
    "reference_code" TEXT,
    "title" TEXT,
    "content_text" TEXT NOT NULL,
    "sequence_order" INTEGER NOT NULL,
    "is_definition" BOOLEAN NOT NULL DEFAULT false,
    "font_family" TEXT,
    "font_size" DOUBLE PRECISION,
    "bbox" DOUBLE PRECISION[],
    "y_coordinate" DOUBLE PRECISION,
    "definition_term" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pdf_document_id" TEXT,

    CONSTRAINT "building_code_content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_references" (
    "id" SERIAL NOT NULL,
    "reference_text" TEXT NOT NULL,
    "reference_type" TEXT NOT NULL DEFAULT 'definition',
    "target_reference_code" TEXT,
    "page_number" INTEGER,
    "font_family" TEXT,
    "font_size" DOUBLE PRECISION,
    "bbox" DOUBLE PRECISION[],
    "confidence_score" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "hyperlink_target" TEXT,
    "reference_position" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_content_id" INTEGER NOT NULL,
    "target_content_id" INTEGER,

    CONSTRAINT "content_references_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE UNIQUE INDEX "jurisdictions_name_key" ON "jurisdictions"("name");

-- CreateIndex
CREATE UNIQUE INDEX "jurisdictions_code_key" ON "jurisdictions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "document_types_name_key" ON "document_types"("name");

-- CreateIndex
CREATE UNIQUE INDEX "languages_code_key" ON "languages"("code");

-- CreateIndex
CREATE UNIQUE INDEX "languages_name_key" ON "languages"("name");

-- CreateIndex
CREATE INDEX "idx_pdf_documents_jurisdiction" ON "pdf_documents"("jurisdiction_id");

-- CreateIndex
CREATE INDEX "idx_pdf_documents_type" ON "pdf_documents"("document_type_id");

-- CreateIndex
CREATE INDEX "idx_pdf_documents_language" ON "pdf_documents"("language_id");

-- CreateIndex
CREATE INDEX "idx_pdf_documents_year" ON "pdf_documents"("year");

-- CreateIndex
CREATE INDEX "idx_pdf_documents_status" ON "pdf_documents"("processing_status");

-- CreateIndex
CREATE INDEX "idx_building_code_content_pdf_document" ON "building_code_content"("pdf_document_id");

-- CreateIndex
CREATE INDEX "idx_building_code_parent" ON "building_code_content"("parent_id");

-- CreateIndex
CREATE INDEX "idx_building_code_reference" ON "building_code_content"("reference_code");

-- CreateIndex
CREATE INDEX "idx_building_code_sequence" ON "building_code_content"("sequence_order");

-- CreateIndex
CREATE INDEX "idx_building_code_type" ON "building_code_content"("contentType");

-- CreateIndex
CREATE INDEX "idx_content_refs_source" ON "content_references"("source_content_id");

-- CreateIndex
CREATE INDEX "idx_content_refs_target" ON "content_references"("target_content_id");

-- CreateIndex
CREATE INDEX "idx_content_refs_code" ON "content_references"("target_reference_code");

-- CreateIndex
CREATE INDEX "idx_content_refs_page" ON "content_references"("page_number");

-- AddForeignKey
ALTER TABLE "pdf_documents" ADD CONSTRAINT "pdf_documents_jurisdiction_id_fkey" FOREIGN KEY ("jurisdiction_id") REFERENCES "jurisdictions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdf_documents" ADD CONSTRAINT "pdf_documents_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "document_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdf_documents" ADD CONSTRAINT "pdf_documents_language_id_fkey" FOREIGN KEY ("language_id") REFERENCES "languages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_code_content" ADD CONSTRAINT "building_code_content_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "building_code_content"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_code_content" ADD CONSTRAINT "building_code_content_pdf_document_id_fkey" FOREIGN KEY ("pdf_document_id") REFERENCES "pdf_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_references" ADD CONSTRAINT "content_references_source_content_id_fkey" FOREIGN KEY ("source_content_id") REFERENCES "building_code_content"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_references" ADD CONSTRAINT "content_references_target_content_id_fkey" FOREIGN KEY ("target_content_id") REFERENCES "building_code_content"("id") ON DELETE SET NULL ON UPDATE CASCADE;
