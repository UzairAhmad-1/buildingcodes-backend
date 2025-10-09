// src/routes/languages.ts
import express from "express";
import { pool } from "../db";

const router = express.Router();

// Get all languages
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, code, name, created_at 
      FROM languages 
      ORDER BY name
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching languages:", error);
    res.status(500).json({ error: "Failed to fetch languages" });
  }
});

// Get language by ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `
      SELECT id, code, name, created_at 
      FROM languages 
      WHERE id = $1
    `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Language not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching language:", error);
    res.status(500).json({ error: "Failed to fetch language" });
  }
});

// Get language by code
router.get("/code/:code", async (req, res) => {
  try {
    const { code } = req.params;
    const result = await pool.query(
      `
      SELECT id, code, name, created_at 
      FROM languages 
      WHERE code = $1
    `,
      [code.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Language not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching language by code:", error);
    res.status(500).json({ error: "Failed to fetch language" });
  }
});

export default router;
