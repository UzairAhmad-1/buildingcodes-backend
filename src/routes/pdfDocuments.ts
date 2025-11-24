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

const navigationCache = new Map<string, any>();
const contentCache = new Map<string, any>();

// Helper function to check if content has children
async function hasChildren(
  contentId: number,
  pdfDocumentId: string
): Promise<boolean> {
  const childCount = await prisma.buildingCodeContent.count({
    where: {
      parentId: contentId,
      pdfDocumentId: pdfDocumentId,
    },
  });
  return childCount > 0;
}

// Helper function to transform field names

const transformContentItem = (item: any) => ({
  id: item.id,
  parent_id: item.parentId,
  content_type: item.contentType,
  page_number: item.pageNumber,
  reference_code: item.referenceCode,
  title: item.title,
  content_text: item.contentText,
  sequence_order: item.sequenceOrder,
  pdf_document_id: item.pdfDocumentId,
  // EXCLUDED FIELDS:
  // font_family: item.fontFamily,
  // font_size: item.fontSize,
  // bbox: item.bbox,
  // y_coordinate: item.yCoordinate,
  // is_definition: item.isDefinition,
  definition_term: item.definitionTerm,
  // created_at: item.createdAt,
  // updated_at: item.updatedAt,
});

const transformReference = (ref: any) => ({
  id: ref.id,
  reference_text: ref.referenceText,
  reference_type: ref.referenceType,
  target_content_id: ref.targetContentId,
  target_reference_code: ref.targetReferenceCode,
  hyperlink_target: ref.hyperlinkTarget,
  page_number: ref.pageNumber,
  reference_position: ref.referencePosition,
  hyperlink_text: ref.hyperlinkText,
  // Remove target_content entirely since it's pointing to wrong content
  target_content: null,
});

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
router.get("/:id/content", async (req, res) => {
  try {
    const { id } = req.params;
    const { parentId, contentType, page = "1", limit = "50" } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Build where clause dynamically
    const where: any = { pdfDocumentId: id };

    if (parentId) {
      where.parentId =
        parentId === "null" ? null : parseInt(parentId as string);
    }

    if (contentType) {
      where.contentType = contentType;
    }

    // Get content items with pagination
    const [content, totalCount] = await Promise.all([
      prisma.buildingCodeContent.findMany({
        where,
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
        skip,
        take: limitNum,
      }),
      prisma.buildingCodeContent.count({ where }),
    ]);

    // Transform the data
    const transformedContent = content.map((item) => ({
      ...transformContentItem(item),
      references: item.sourceReferences.map(transformReference),
    }));

    const response = {
      documentId: id,
      content: transformedContent,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCount,
        pages: Math.ceil(totalCount / limitNum),
      },
    };

    console.log(
      `Fetched ${content.length} content items for document ID: ${id}`
    );
    res.json(response);
  } catch (error: unknown) {
    console.error("Error fetching document content:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    res.status(500).json({ error: "Failed to fetch document content" });
  }
});

router.get("/:id/content/:contentId", async (req, res) => {
  try {
    const { id, contentId } = req.params;
    const numericContentId = parseInt(contentId);

    console.log("Requested contentId:", numericContentId);

    // 1. Fetch the main content item
    const mainContent = await prisma.buildingCodeContent.findUnique({
      where: { id: numericContentId },
    });

    if (!mainContent) {
      return res.status(404).json({ error: "Content not found" });
    }

    console.log("Main Content Type:", mainContent.contentType);

    // 2. Find the next item of the same type to calculate row gap
    let nextSameType = null;
    let rowGap = 0;
    let isLastDivision = false;

    if (mainContent.contentType === "division") {
      // For divisions, find next division
      nextSameType = await prisma.buildingCodeContent.findFirst({
        where: {
          pdfDocumentId: id,
          contentType: "division",
          sequenceOrder: { gt: mainContent.sequenceOrder },
        },
        orderBy: { sequenceOrder: "asc" },
      });

      const startSeq = mainContent.sequenceOrder;

      if (nextSameType) {
        // Normal case: there's a next division
        const endSeq = nextSameType.sequenceOrder - 1;
        rowGap = endSeq - startSeq;
        console.log("Next Division:", nextSameType.id);
        console.log("Next Division Sequence:", nextSameType.sequenceOrder);
      } else {
        // Special case: this is the last division in the document
        isLastDivision = true;

        // Calculate actual row gap by finding the last content item in this division
        const lastContentInDivision =
          await prisma.buildingCodeContent.findFirst({
            where: {
              pdfDocumentId: id,
              OR: [
                { id: numericContentId },
                { parentId: numericContentId },
                {
                  parent: {
                    parentId: numericContentId,
                  },
                },
              ],
            },
            orderBy: { sequenceOrder: "desc" },
          });

        if (lastContentInDivision) {
          const endSeq = lastContentInDivision.sequenceOrder;
          rowGap = endSeq - startSeq;
          console.log("Last content in division sequence:", endSeq);
        } else {
          // Fallback: if no children found, use current division sequence
          rowGap = 0;
        }

        console.log("Next Division: Not found - LAST DIVISION IN DOCUMENT");
        console.log("Next Division Sequence: END OF DOCUMENT");
      }

      console.log("Current Division Sequence:", startSeq);
    } else {
      // For other content types (parts, sections, etc.), find next item with same parent
      // Only proceed if parentId exists
      if (mainContent.parentId) {
        nextSameType = await prisma.buildingCodeContent.findFirst({
          where: {
            pdfDocumentId: id,
            parentId: mainContent.parentId,
            contentType: mainContent.contentType,
            sequenceOrder: { gt: mainContent.sequenceOrder },
          },
          orderBy: { sequenceOrder: "asc" },
        });

        const startSeq = mainContent.sequenceOrder;

        // If no next same type found, find the next item with different type but same parent level
        let endSeq;
        if (nextSameType) {
          endSeq = nextSameType.sequenceOrder - 1;
        } else {
          // Find the next item with the same parent (any type) to determine the actual end
          const nextAnyTypeSameParent =
            await prisma.buildingCodeContent.findFirst({
              where: {
                pdfDocumentId: id,
                parentId: mainContent.parentId,
                sequenceOrder: { gt: mainContent.sequenceOrder },
              },
              orderBy: { sequenceOrder: "asc" },
            });

          if (nextAnyTypeSameParent) {
            endSeq = nextAnyTypeSameParent.sequenceOrder - 1;
          } else {
            // If no next item with same parent, find the next item with parent's parent (moving up one level)
            const parentItem = await prisma.buildingCodeContent.findUnique({
              where: { id: mainContent.parentId },
              select: { parentId: true },
            });

            if (parentItem?.parentId) {
              const nextInParentLevel =
                await prisma.buildingCodeContent.findFirst({
                  where: {
                    pdfDocumentId: id,
                    parentId: parentItem.parentId,
                    sequenceOrder: { gt: mainContent.sequenceOrder },
                  },
                  orderBy: { sequenceOrder: "asc" },
                });
              endSeq = nextInParentLevel
                ? nextInParentLevel.sequenceOrder - 1
                : mainContent.sequenceOrder + 100; // Safe fallback
            } else {
              // Final fallback - use a reasonable small number
              endSeq = mainContent.sequenceOrder + 100;
            }
          }
        }

        rowGap = endSeq - startSeq;

        console.log(
          `Next ${mainContent.contentType}:`,
          nextSameType?.id || "Not found"
        );
        console.log(`Current ${mainContent.contentType} Sequence:`, startSeq);
        console.log(
          `Next ${mainContent.contentType} Sequence:`,
          nextSameType?.sequenceOrder || "Not applicable"
        );
        console.log(`Calculated end sequence:`, endSeq);
      } else {
        // If no parentId, use a safe default row gap
        rowGap = 100;
        console.log("No parentId found, using default row gap:", rowGap);
      }
    }

    console.log("Row Gap:", rowGap);
    console.log("Is Last Division:", isLastDivision);

    // 3. Check if content is large (more than 1000 rows)
    // REMOVED: && !isLastDivision condition - last divisions should also follow the same rule
    const isLargeContent = rowGap > 1000;

    if (isLargeContent) {
      console.log(
        `Large ${mainContent.contentType} detected → returning only immediate children`
      );

      // Determine what child content type to show based on current type
      let childContentType = "";
      switch (mainContent.contentType) {
        case "division":
          childContentType = "part";
          break;
        case "part":
          childContentType = "section";
          break;
        case "section":
          childContentType = "subsection";
          break;
        case "subsection":
          childContentType = "article";
          break;
        case "article":
          childContentType = "sentence";
          break;
        default:
          childContentType = ""; // Show all children for other types
      }

      // Build query for immediate children
      const whereClause: any = {
        pdfDocumentId: id,
        parentId: numericContentId,
      };

      // Only filter by contentType if we specified one
      if (childContentType) {
        whereClause.contentType = childContentType;
      }

      // Fetch only immediate children
      const immediateChildren = await prisma.buildingCodeContent.findMany({
        where: whereClause,
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
                },
              },
            },
            orderBy: {
              referencePosition: "asc",
            },
          },
        },
        orderBy: { sequenceOrder: "asc" },
      });

      // Check which children have their own children
      const childrenWithMetadata = await Promise.all(
        immediateChildren.map(async (child) => {
          const hasChildItems = await hasChildren(child.id, id);
          return {
            ...transformContentItem(child),
            references: child.sourceReferences.map(transformReference),
            link: `/api/pdf-documents/${id}/content?parentId=${child.id}`,
            hasChildren: hasChildItems,
            isLargeSection: hasChildItems,
          };
        })
      );

      const response = {
        ...transformContentItem(mainContent),
        references: [],
        children: childrenWithMetadata,
        metadata: {
          isLargeContent: true,
          contentType: mainContent.contentType,
          totalRowsInSection: rowGap + 1,
          message: `${mainContent.contentType} is large. Showing only immediate children for better performance.`,
          childCount: childrenWithMetadata.length,
          childType: childContentType || "all",
          isLastDivision: isLastDivision, // Include this info in metadata
        },
      };

      console.log(
        `Returning ${childrenWithMetadata.length} ${
          childContentType || "children"
        } instead of ${rowGap + 1} total rows`
      );
      return res.json(response);
    }

    // 4. Small content → return full hierarchy
    console.log(`Small ${mainContent.contentType} → returning full hierarchy`);

    // Recursive function to get full hierarchy
    const getContentHierarchy = async (parentId: number): Promise<any[]> => {
      const children = await prisma.buildingCodeContent.findMany({
        where: {
          parentId: parentId,
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

      const childrenWithHierarchy = await Promise.all(
        children.map(async (child) => {
          const childWithChildren = {
            ...transformContentItem(child),
            references: child.sourceReferences.map(transformReference),
            children: await getContentHierarchy(child.id),
          };
          return childWithChildren;
        })
      );

      return childrenWithHierarchy;
    };

    const children = await getContentHierarchy(numericContentId);

    const response = {
      ...transformContentItem(mainContent),
      references: [],
      children: children,
      metadata: {
        isLargeContent: false,
        contentType: mainContent.contentType,
        totalRowsInSection: rowGap + 1,
        message: "Showing full content hierarchy",
        childCount: children.length,
        isLastDivision: isLastDivision,
      },
    };

    console.log(
      `Returning full hierarchy with ${children.length} immediate children`
    );
    return res.json(response);
  } catch (error) {
    console.error("Error fetching content:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    res
      .status(500)
      .json({ error: "Failed to fetch content", details: errorMessage });
  }
});
// In your routes/pdfDocuments.ts - Fix the navigation endpoint
router.get("/:id/navigation", async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`Fetching navigation for document: ${id}`);

    // Check cache first
    const cacheKey = `navigation-${id}`;
    if (navigationCache.has(cacheKey)) {
      console.log(`Returning cached navigation for: ${id}`);
      return res.json(navigationCache.get(cacheKey));
    }

    const navigationContent = await prisma.buildingCodeContent.findMany({
      where: {
        pdfDocumentId: id,
        contentType: {
          in: [
            "division",
            "part",
            "section",
            "subsection",
            "article",
            "note_section",
            "note_item",
          ],
        },
      },
      select: {
        id: true,
        parentId: true,
        contentType: true,
        pageNumber: true,
        referenceCode: true,
        title: true,
        contentText: true,
        sequenceOrder: true,
      },
      orderBy: {
        sequenceOrder: "asc",
      },
    });

    console.log(`Found ${navigationContent.length} navigation items`);

    const buildNavigationHierarchy = (parentId: number | null): any[] => {
      const children = navigationContent.filter(
        (item) => item.parentId === parentId
      );
      return children.map((item) => ({
        id: item.id,
        parent_id: item.parentId,
        content_type: item.contentType,
        page_number: item.pageNumber,
        reference_code: item.referenceCode,
        title: truncateTitle(item.title, 10),
        sequence_order: item.sequenceOrder,
        content_text: [
          "division",
          "part",
          "section",
          "subsection",
          "article",
          "note_section",
          "note_item",
        ].includes(item.contentType)
          ? item.contentText
          : null,
        children: buildNavigationHierarchy(item.id),
      }));
    };

    const navigationHierarchy = buildNavigationHierarchy(null);
    const response = {
      documentId: id,
      navigation: navigationHierarchy,
    };

    console.log(
      `Built navigation hierarchy with ${navigationHierarchy.length} root items`
    );

    // Cache for 5 minutes
    navigationCache.set(cacheKey, response);
    setTimeout(() => navigationCache.delete(cacheKey), 5 * 60 * 1000);

    res.json(response);
  } catch (error: unknown) {
    console.error("Error fetching navigation:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    res.status(500).json({
      error: "Failed to fetch navigation",
      details: errorMessage,
    });
  }
});

// Search endpoint
router.get("/:id/search", async (req, res) => {
  try {
    const { id } = req.params;
    const { q: query, contentType, page = "1", limit = "20" } = req.query;

    if (!query) {
      return res.status(400).json({ error: "Search query is required" });
    }

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    const where: any = {
      pdfDocumentId: id,
      OR: [
        { title: { contains: query as string, mode: "insensitive" } },
        { contentText: { contains: query as string, mode: "insensitive" } },
        { referenceCode: { contains: query as string, mode: "insensitive" } },
      ],
    };

    if (contentType) {
      where.contentType = contentType;
    }

    const [results, totalCount] = await Promise.all([
      prisma.buildingCodeContent.findMany({
        where,
        select: {
          id: true,
          parentId: true,
          contentType: true,
          pageNumber: true,
          referenceCode: true,
          title: true,
          contentText: true,
          sequenceOrder: true,
        },
        orderBy: {
          sequenceOrder: "asc",
        },
        skip,
        take: limitNum,
      }),
      prisma.buildingCodeContent.count({ where }),
    ]);

    const response = {
      documentId: id,
      results: results.map((item) => transformContentItem(item)),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCount,
        pages: Math.ceil(totalCount / limitNum),
      },
    };

    res.json(response);
  } catch (error: unknown) {
    console.error("Error searching content:", error);
    res.status(500).json({ error: "Failed to search content" });
  }
});

// Helper function to truncate titles safely
const truncateTitle = (title: string | null, wordLimit: number = 10) => {
  if (!title) return "";
  const words = title.split(/\s+/);
  return words.length <= wordLimit
    ? title
    : words.slice(0, wordLimit).join(" ") + "...";
};

export default router;
