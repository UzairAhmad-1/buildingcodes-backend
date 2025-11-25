// src/routes/search.ts
import express from "express";
import prisma from "../db";

const router = express.Router();

// Search across all documents or a specific document
router.get("/", async (req, res) => {
  try {
    const { q, documentId, page = 1, limit = 10 } = req.query;
    console.log("Search request received with params:", {
      q,
      documentId,
      page,
      limit,
    });
    if (!q) {
      return res.status(400).json({ error: "Query parameter 'q' is required" });
    }

    const pageNumber = Number(page);
    const pageSize = Number(limit);
    const skip = (pageNumber - 1) * pageSize;

    // SIMPLE WHERE CLAUSE - No complex NOT operators
    const whereClause: any = {
      OR: [
        { contentText: { contains: q as string, mode: "insensitive" } },
        { title: { contains: q as string, mode: "insensitive" } },
        { referenceCode: { contains: q as string, mode: "insensitive" } },
      ],
    };

    if (documentId) {
      whereClause.pdfDocumentId = documentId as string;
    }

    console.log("Executing SIMPLE search query");

    // Fetch paginated content with related document info
    const [results, totalCount] = await Promise.all([
      prisma.buildingCodeContent.findMany({
        where: whereClause,
        include: {
          pdfDocument: {
            include: {
              jurisdiction: true,
              documentType: true,
            },
          },
        },
        orderBy: [{ pdfDocumentId: "asc" }, { sequenceOrder: "asc" }],
        skip,
        take: pageSize,
      }),
      prisma.buildingCodeContent.count({ where: whereClause }),
    ]);

    // Filter out empty/null content in APPLICATION CODE (not in database)
    const filteredResults = results.filter(
      (item) => item.contentText && item.contentText.trim() !== ""
    );

    // Map results to match your previous structure (flat JSON)
    const formattedResults = filteredResults.map((item) => ({
      id: item.id,
      parentId: item.parentId,
      contentType: item.contentType,
      pageNumber: item.pageNumber,
      referenceCode: item.referenceCode,
      title: item.title,
      contentText: item.contentText,
      sequenceOrder: item.sequenceOrder,
      pdfDocumentId: item.pdfDocumentId,
      fontFamily: item.fontFamily,
      fontSize: item.fontSize,
      bbox: item.bbox,
      yCoordinate: item.yCoordinate,
      document_title: item.pdfDocument?.title || null,
      jurisdiction_name: item.pdfDocument?.jurisdiction?.name || null,
      document_type_name: item.pdfDocument?.documentType?.name || null,
      year: item.pdfDocument?.year || null,
    }));

    res.json({
      results: formattedResults,
      pagination: {
        page: pageNumber,
        limit: pageSize,
        total: totalCount, // This is total before filtering empty strings
        totalPages: Math.ceil(totalCount / pageSize),
      },
    });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error("Search error:", errorMessage);
    res.status(500).json({ error: "Search failed" });
  }
});

export default router;
