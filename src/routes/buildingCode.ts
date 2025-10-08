// src/routes/buildingCode.ts
import express from "express";
import { pool } from "../db";

const router = express.Router();

// Get entire hierarchy
router.get("/hierarchy", async (req, res) => {
  try {
    const result = await pool.query(`
      WITH RECURSIVE content_tree AS (
        SELECT 
          id,
          parent_id,
          content_type,
          page_number,
          reference_code,
          title,
          content_text,
          sequence_order,
          ARRAY[sequence_order] as path
        FROM building_code_content 
        WHERE parent_id IS NULL
        
        UNION ALL
        
        SELECT 
          c.id,
          c.parent_id,
          c.content_type,
          c.page_number,
          c.reference_code,
          c.title,
          c.content_text,
          c.sequence_order,
          ct.path || c.sequence_order
        FROM building_code_content c
        JOIN content_tree ct ON c.parent_id = ct.id
      )
      SELECT * FROM content_tree 
      ORDER BY path;
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching hierarchy:", error);
    res.status(500).json({ error: "Failed to fetch hierarchy" });
  }
});

// Get content by type
router.get("/content/:type", async (req, res) => {
  try {
    const { type } = req.params;
    const result = await pool.query(
      "SELECT * FROM building_code_content WHERE content_type = $1 ORDER BY sequence_order",
      [type]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching content by type:", error);
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

    const result = await pool.query(
      `SELECT * FROM building_code_content 
       WHERE content_text ILIKE $1 OR title ILIKE $1 
       ORDER BY sequence_order`,
      [`%${q}%`]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Search error:", error);
    res.status(500).json({ error: "Search failed" });
  }
});

export default router;
