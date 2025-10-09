// src/routes/jurisdictions.ts
import express from "express";
import { pool } from "../db";

const router = express.Router();

// Get all jurisdictions
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, code, created_at 
      FROM jurisdictions 
      ORDER BY name
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching jurisdictions:", error);
    res.status(500).json({ error: "Failed to fetch jurisdictions" });
  }
});

// Get jurisdiction by ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `
      SELECT id, name, code, created_at 
      FROM jurisdictions 
      WHERE id = $1
    `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Jurisdiction not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching jurisdiction:", error);
    res.status(500).json({ error: "Failed to fetch jurisdiction" });
  }
});

// Get jurisdiction by code
router.get("/code/:code", async (req, res) => {
  try {
    const { code } = req.params;
    const result = await pool.query(
      `
      SELECT id, name, code, created_at 
      FROM jurisdictions 
      WHERE code = $1
    `,
      [code.toUpperCase()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Jurisdiction not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching jurisdiction by code:", error);
    res.status(500).json({ error: "Failed to fetch jurisdiction" });
  }
});

export default router;
