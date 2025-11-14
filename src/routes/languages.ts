// src/routes/languages.ts
import express from "express";
import prisma from "../db";

const router = express.Router();

// Get all languages
router.get("/", async (req, res) => {
  try {
    const languages = await prisma.language.findMany({
      orderBy: {
        name: "asc",
      },
    });
    res.json(languages);
  } catch (error: unknown) {
    console.error("Error fetching languages:", error);
    res.status(500).json({ error: "Failed to fetch languages" });
  }
});

// Get language by ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const language = await prisma.language.findUnique({
      where: { id: parseInt(id) },
    });

    if (!language) {
      return res.status(404).json({ error: "Language not found" });
    }

    res.json(language);
  } catch (error: unknown) {
    console.error("Error fetching language:", error);
    res.status(500).json({ error: "Failed to fetch language" });
  }
});

// Get language by code
router.get("/code/:code", async (req, res) => {
  try {
    const { code } = req.params;
    const language = await prisma.language.findUnique({
      where: { code: code.toLowerCase() },
    });

    if (!language) {
      return res.status(404).json({ error: "Language not found" });
    }

    res.json(language);
  } catch (error: unknown) {
    console.error("Error fetching language by code:", error);
    res.status(500).json({ error: "Failed to fetch language" });
  }
});

export default router;
