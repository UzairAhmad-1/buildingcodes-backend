// src/routes/documentTypes.ts
import express from "express";
import prisma from "../db";

const router = express.Router();

// Get all document types
router.get("/", async (req, res) => {
  try {
    const documentTypes = await prisma.documentType.findMany({
      orderBy: {
        name: 'asc'
      }
    });
    res.json(documentTypes);
  } catch (error: unknown) {
    console.error("Error fetching document types:", error);
    res.status(500).json({ error: "Failed to fetch document types" });
  }
});

// Get document type by ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const documentType = await prisma.documentType.findUnique({
      where: { id: parseInt(id) }
    });

    if (!documentType) {
      return res.status(404).json({ error: "Document type not found" });
    }

    res.json(documentType);
  } catch (error: unknown) {
    console.error("Error fetching document type:", error);
    res.status(500).json({ error: "Failed to fetch document type" });
  }
});

export default router;