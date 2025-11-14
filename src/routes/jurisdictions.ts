// src/routes/jurisdictions.ts
import express from "express";
import prisma from "../db";

const router = express.Router();

// Get all jurisdictions
router.get("/", async (req, res) => {
  try {
    const jurisdictions = await prisma.jurisdiction.findMany({
      orderBy: {
        name: "asc",
      },
    });
    res.json(jurisdictions);
  } catch (error: unknown) {
    console.error("Error fetching jurisdictions:", error);
    res.status(500).json({ error: "Failed to fetch jurisdictions" });
  }
});

// Get jurisdiction by ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const jurisdiction = await prisma.jurisdiction.findUnique({
      where: { id: parseInt(id) },
    });

    if (!jurisdiction) {
      return res.status(404).json({ error: "Jurisdiction not found" });
    }

    res.json(jurisdiction);
  } catch (error: unknown) {
    console.error("Error fetching jurisdiction:", error);
    res.status(500).json({ error: "Failed to fetch jurisdiction" });
  }
});

// Get jurisdiction by code
router.get("/code/:code", async (req, res) => {
  try {
    const { code } = req.params;
    const jurisdiction = await prisma.jurisdiction.findUnique({
      where: { code: code.toUpperCase() },
    });

    if (!jurisdiction) {
      return res.status(404).json({ error: "Jurisdiction not found" });
    }

    res.json(jurisdiction);
  } catch (error: unknown) {
    console.error("Error fetching jurisdiction by code:", error);
    res.status(500).json({ error: "Failed to fetch jurisdiction" });
  }
});

export default router;
