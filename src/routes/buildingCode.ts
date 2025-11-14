// src/routes/buildingCode.ts
import express from "express";
import prisma from "../db";
import { ContentType } from "@prisma/client";

const router = express.Router();

// Define interfaces locally since Prisma types might not be available yet
interface BuildingCodeContent {
  id: number;
  parentId: number | null;
  contentType: ContentType;
  pageNumber: number | null;
  referenceCode: string | null;
  title: string | null;
  contentText: string;
  sequenceOrder: number;
  pdfDocumentId: string | null;
  isDefinition: boolean;
  fontFamily: string | null;
  fontSize: number | null;
  bbox: number[];
  yCoordinate: number | null;
  definitionTerm: string | null;
  createdAt: Date;
  updatedAt: Date;
  children?: BuildingCodeContent[];
  sourceReferences?: any[];
}

// Define a type for the hierarchy item
interface HierarchyItem extends BuildingCodeContent {
  children: HierarchyItem[];
  sourceReferences?: any[];
}

// Get entire hierarchy
router.get("/hierarchy", async (req, res) => {
  try {
    // Since Prisma doesn't support recursive CTEs directly, we'll fetch all content and build hierarchy in memory
    const content = await prisma.buildingCodeContent.findMany({
      include: {
        children: true,
        sourceReferences: {
          include: {
            targetContent: true,
          },
        },
      },
      orderBy: {
        sequenceOrder: "asc",
      },
    });

    // Build hierarchy in memory with proper typing
    const buildHierarchy = (parentId: number | null): HierarchyItem[] => {
      return content
        .filter((item: any) => item.parentId === parentId)
        .map((item: any) => ({
          ...item,
          children: buildHierarchy(item.id),
        }));
    };

    const hierarchy = buildHierarchy(null);
    res.json(hierarchy);
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error("Error fetching hierarchy:", errorMessage);
    res.status(500).json({ error: "Failed to fetch hierarchy" });
  }
});

// Get content by type
router.get("/content/:type", async (req, res) => {
  try {
    const { type } = req.params;

    // Validate and convert the type to ContentType enum
    const validContentTypes: string[] = [
      "division",
      "part",
      "section",
      "subsection",
      "article",
      "sentence",
      "clause",
      "subclause",
    ];

    if (!validContentTypes.includes(type)) {
      return res.status(400).json({
        error: "Invalid content type",
        validTypes: validContentTypes,
      });
    }

    const result = await prisma.buildingCodeContent.findMany({
      where: {
        contentType: type as ContentType,
      },
      orderBy: {
        sequenceOrder: "asc",
      },
    });
    res.json(result);
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error("Error fetching content by type:", errorMessage);
    res.status(500).json({ error: "Failed to fetch content" });
  }
});

// Search content
router.get("/search", async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ error: "Query parameter 'q' is required" });
    }

    const result = await prisma.buildingCodeContent.findMany({
      where: {
        OR: [
          { contentText: { contains: q as string, mode: "insensitive" } },
          { title: { contains: q as string, mode: "insensitive" } },
        ],
      },
      orderBy: {
        sequenceOrder: "asc",
      },
    });
    res.json(result);
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error("Search error:", errorMessage);
    res.status(500).json({ error: "Search failed" });
  }
});

export default router;
