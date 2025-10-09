// src/routes/documentTypes.ts
import express from "express";
import { pool } from "../db";

const router = express.Router();

// Get all document types
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, description, created_at 
      FROM document_types 
      ORDER BY name
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching document types:", error);
    res.status(500).json({ error: "Failed to fetch document types" });
  }
});

// Get document type by ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `
      SELECT id, name, description, created_at 
      FROM document_types 
      WHERE id = $1
    `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Document type not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching document type:", error);
    res.status(500).json({ error: "Failed to fetch document type" });
  }
});

export default router;
