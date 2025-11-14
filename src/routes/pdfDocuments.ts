// src/routes/pdfDocuments.ts
import express from "express";
import prisma from "../db";
import { upload } from "../middleware/upload";
import { authenticateToken, AuthRequest } from "../middleware/auth";
import fs from "fs";
import {
  BuildingCodeContent,
  ContentReference,
  PdfDocument,
} from "@prisma/client";

const router = express.Router();

// Define interfaces for transformed documents
interface TransformedPdfDocument extends Omit<PdfDocument, "fileSize"> {
  fileSize: number | null;
  jurisdiction_name?: string;
  jurisdiction_code?: string;
  document_type_name?: string;
  language_name?: string;
  language_code?: string;
}

interface HierarchyContent extends BuildingCodeContent {
  references?: ContentReference[];
  children?: HierarchyContent[];
}

// Helper function to convert BigInt to number for JSON serialization
const transformPdfDocument = (doc: any): TransformedPdfDocument => {
  return {
    ...doc,
    fileSize: doc.fileSize ? Number(doc.fileSize) : null,
    jurisdiction_name: doc.jurisdiction?.name,
    jurisdiction_code: doc.jurisdiction?.code,
    document_type_name: doc.documentType?.name,
    language_name: doc.language?.name,
    language_code: doc.language?.code,
  };
};

// Upload PDF document
router.post(
  "/upload",
  authenticateToken,
  upload.single("pdf"),
  async (req: AuthRequest, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No PDF file uploaded" });
      }

      const {
        title,
        year,
        version,
        effective_date,
        jurisdiction_id,
        document_type_id,
        language_id,
      } = req.body;

      // Validate required fields
      if (
        !title ||
        !year ||
        !jurisdiction_id ||
        !document_type_id ||
        !language_id
      ) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({
          error:
            "Title, year, jurisdiction, document type, and language are required",
        });
      }

      console.log("File uploaded to:", req.file.path);
      console.log("File name:", req.file.filename);

      // Insert into database using Prisma - convert fileSize to BigInt
      const uploadedDocument = await prisma.pdfDocument.create({
        data: {
          fileName: req.file.filename,
          originalFileName: req.file.originalname,
          fileSize: BigInt(req.file.size), // Convert to BigInt for Prisma
          filePath: req.file.filename,
          title,
          year: parseInt(year),
          version: version || null,
          effectiveDate: effective_date ? new Date(effective_date) : null,
          jurisdictionId: parseInt(jurisdiction_id),
          documentTypeId: parseInt(document_type_id),
          languageId: parseInt(language_id),
          processingStatus: "uploaded",
        },
      });

      // Transform the response to convert BigInt to number
      const responseDocument = transformPdfDocument(uploadedDocument);

      res.status(201).json({
        message: "PDF uploaded successfully",
        document: responseDocument,
      });
    } catch (error: unknown) {
      console.error("Upload error:", error);

      if (req.file) {
        fs.unlinkSync(req.file.path);
      }

      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      res.status(500).json({ error: "Failed to upload PDF document" });
    }
  }
);

// Delete PDF document
router.delete("/:id", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    // First get the document to find the file path
    const document = await prisma.pdfDocument.findUnique({
      where: { id },
    });

    if (!document) {
      return res.status(404).json({ error: "PDF document not found" });
    }

    // Delete from database (Prisma will handle related records due to cascading)
    await prisma.pdfDocument.delete({
      where: { id },
    });

    // Delete the file
    if (document.filePath && fs.existsSync(document.filePath)) {
      fs.unlinkSync(document.filePath);
    }

    res.json({ message: "PDF document deleted successfully" });
  } catch (error: unknown) {
    console.error("Delete error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    res.status(500).json({ error: "Failed to delete PDF document" });
  }
});

// Get all PDF documents with related data
router.get("/", async (req, res) => {
  try {
    const documents = await prisma.pdfDocument.findMany({
      include: {
        jurisdiction: {
          select: {
            name: true,
            code: true,
          },
        },
        documentType: {
          select: {
            name: true,
          },
        },
        language: {
          select: {
            name: true,
            code: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Transform the data to convert BigInt to number
    const transformedDocuments: TransformedPdfDocument[] = documents.map(
      (doc) => transformPdfDocument(doc)
    );
    console.log("Fetched PDF documents:", transformedDocuments);
    res.json(transformedDocuments);
  } catch (error: unknown) {
    console.error("Error fetching PDF documents:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    res.status(500).json({ error: "Failed to fetch PDF documents" });
  }
});

// Get PDF document by ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const document = await prisma.pdfDocument.findUnique({
      where: { id },
      include: {
        jurisdiction: {
          select: {
            name: true,
            code: true,
          },
        },
        documentType: {
          select: {
            name: true,
          },
        },
        language: {
          select: {
            name: true,
            code: true,
          },
        },
      },
    });

    if (!document) {
      return res.status(404).json({ error: "PDF document not found" });
    }

    // Transform the data
    const transformedDocument = transformPdfDocument(document);

    res.json(transformedDocument);
  } catch (error: unknown) {
    console.error("Error fetching PDF document:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    res.status(500).json({ error: "Failed to fetch PDF document" });
  }
});

// Get PDF documents by jurisdiction
router.get("/jurisdiction/:jurisdictionId", async (req, res) => {
  try {
    const { jurisdictionId } = req.params;
    const documents = await prisma.pdfDocument.findMany({
      where: {
        jurisdictionId: parseInt(jurisdictionId),
      },
      include: {
        jurisdiction: {
          select: {
            name: true,
            code: true,
          },
        },
        documentType: {
          select: {
            name: true,
          },
        },
        language: {
          select: {
            name: true,
            code: true,
          },
        },
      },
      orderBy: [{ year: "desc" }, { title: "asc" }],
    });

    const transformedDocuments: TransformedPdfDocument[] = documents.map(
      (doc) => transformPdfDocument(doc)
    );

    res.json(transformedDocuments);
  } catch (error: unknown) {
    console.error("Error fetching PDF documents by jurisdiction:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    res.status(500).json({ error: "Failed to fetch PDF documents" });
  }
});

// Get PDF documents by document type
router.get("/type/:documentTypeId", async (req, res) => {
  try {
    const { documentTypeId } = req.params;
    const documents = await prisma.pdfDocument.findMany({
      where: {
        documentTypeId: parseInt(documentTypeId),
      },
      include: {
        jurisdiction: {
          select: {
            name: true,
            code: true,
          },
        },
        documentType: {
          select: {
            name: true,
          },
        },
        language: {
          select: {
            name: true,
            code: true,
          },
        },
      },
      orderBy: [{ year: "desc" }, { title: "asc" }],
    });

    const transformedDocuments: TransformedPdfDocument[] = documents.map(
      (doc) => transformPdfDocument(doc)
    );

    res.json(transformedDocuments);
  } catch (error: unknown) {
    console.error("Error fetching PDF documents by type:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    res.status(500).json({ error: "Failed to fetch PDF documents" });
  }
});

// Get building code content for a specific PDF document with references
router.get("/:id/content", async (req, res) => {
  try {
    const { id } = req.params;

    // Get all content items for this document with their references
    const content = await prisma.buildingCodeContent.findMany({
      where: {
        pdfDocumentId: id,
      },
      include: {
        sourceReferences: {
          include: {
            targetContent: {
              select: {
                id: true,
                parentId: true,
                contentType: true,
                pageNumber: true,
                referenceCode: true,
                title: true,
                contentText: true,
                sequenceOrder: true,
                pdfDocumentId: true,
                fontFamily: true,
                fontSize: true,
                bbox: true,
                yCoordinate: true,
                isDefinition: true,
                definitionTerm: true,
              },
            },
          },
          orderBy: {
            referencePosition: "asc",
          },
        },
      },
      orderBy: {
        sequenceOrder: "asc",
      },
    });

    // Build complete hierarchy recursively and transform field names to match original response
    const buildHierarchy = (parentId: number | null): any[] => {
      return content
        .filter((item) => item.parentId === parentId)
        .map((item) => {
          // Transform references to match original structure
          const transformedReferences = item.sourceReferences.map((ref) => ({
            id: ref.id,
            reference_text: ref.referenceText,
            reference_type: ref.referenceType,
            target_content_id: ref.targetContentId,
            target_reference_code: ref.targetReferenceCode,
            hyperlink_target: ref.hyperlinkTarget,
            page_number: ref.pageNumber,
            font_family: ref.fontFamily,
            bbox: ref.bbox,
            reference_position: ref.referencePosition,
            target_content: ref.targetContent
              ? {
                  id: ref.targetContent.id,
                  parent_id: ref.targetContent.parentId,
                  content_type: ref.targetContent.contentType,
                  page_number: ref.targetContent.pageNumber,
                  reference_code: ref.targetContent.referenceCode,
                  title: ref.targetContent.title,
                  content_text: ref.targetContent.contentText,
                  sequence_order: ref.targetContent.sequenceOrder,
                  pdf_document_id: ref.targetContent.pdfDocumentId,
                  font_family: ref.targetContent.fontFamily,
                  font_size: ref.targetContent.fontSize,
                  bbox: ref.targetContent.bbox,
                  y_coordinate: ref.targetContent.yCoordinate,
                  is_definition: ref.targetContent.isDefinition,
                  definition_term: ref.targetContent.definitionTerm,
                }
              : null,
          }));

          return {
            id: item.id,
            parent_id: item.parentId,
            content_type: item.contentType,
            page_number: item.pageNumber,
            reference_code: item.referenceCode,
            title: item.title,
            content_text: item.contentText,
            sequence_order: item.sequenceOrder,
            pdf_document_id: item.pdfDocumentId,
            font_family: item.fontFamily,
            font_size: item.fontSize,
            bbox: item.bbox,
            y_coordinate: item.yCoordinate,
            is_definition: item.isDefinition,
            definition_term: item.definitionTerm,
            created_at: item.createdAt,
            updated_at: item.updatedAt,
            references: transformedReferences,
            children: buildHierarchy(item.id),
          };
        });
    };

    const hierarchy = buildHierarchy(null);

    const response = {
      documentId: id,
      content: hierarchy,
    };

    console.log("Fetched document content for document ID:", id);

    res.json(response);
  } catch (error: unknown) {
    console.error("Error fetching document content:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    res.status(500).json({ error: "Failed to fetch document content" });
  }
});
export default router;
