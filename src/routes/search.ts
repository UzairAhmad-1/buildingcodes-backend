// src/routes/search.ts - Updated version
import express from "express";
import { pool } from "../db";

const router = express.Router();

// Search across all documents or specific document
router.get("/", async (req, res) => {
  try {
    const { q, documentId, page = 1, limit = 10 } = req.query;

    if (!q) {
      return res.status(400).json({ error: "Query parameter 'q' is required" });
    }

    const offset = (Number(page) - 1) * Number(limit);
    const searchTerm = `%${q}%`;

    let baseQuery = `
      SELECT 
        bcc.id,
        bcc.parent_id,
        bcc.content_type,
        bcc.page_number,
        bcc.reference_code,
        bcc.title,
        bcc.content_text,
        bcc.sequence_order,
        bcc.pdf_document_id,
        bcc.font_family,
        bcc.font_size,
        bcc.bbox,
        bcc.y_coordinate,
        pd.title as document_title,
        pd.jurisdiction_name,
        pd.document_type_name,
        pd.year,
        COUNT(*) OVER() as total_count
      FROM building_code_content bcc
      JOIN (
        SELECT 
          pd.id,
          pd.title,
          j.name as jurisdiction_name,
          dt.name as document_type_name,
          pd.year
        FROM pdf_documents pd
        LEFT JOIN jurisdictions j ON pd.jurisdiction_id = j.id
        LEFT JOIN document_types dt ON pd.document_type_id = dt.id
      ) pd ON bcc.pdf_document_id = pd.id
      WHERE (
        bcc.content_text ILIKE $1 
        OR bcc.title ILIKE $1 
        OR bcc.reference_code ILIKE $1
      )
      AND (bcc.content_text IS NOT NULL AND bcc.content_text != '')
    `;

    let countQuery = `
      SELECT COUNT(*) as total
      FROM building_code_content bcc
      WHERE (
        bcc.content_text ILIKE $1 
        OR bcc.title ILIKE $1 
        OR bcc.reference_code ILIKE $1
      )
      AND (bcc.content_text IS NOT NULL AND bcc.content_text != '')
    `;

    const queryParams: any[] = [searchTerm];

    // Add document filter if provided
    if (documentId) {
      baseQuery += ` AND bcc.pdf_document_id = $${queryParams.length + 1}`;
      countQuery += ` AND bcc.pdf_document_id = $${queryParams.length + 1}`;
      queryParams.push(documentId);
    }

    // Add ordering - prioritize articles and reference codes
    baseQuery += `
      ORDER BY 
        bcc.pdf_document_id,
        bcc.sequence_order,
        CASE 
          WHEN bcc.content_type = 'article' THEN 1
          WHEN bcc.content_type = 'subsection' THEN 2
          WHEN bcc.content_type = 'sentence' THEN 3
          WHEN bcc.content_type = 'clause' THEN 4
          ELSE 5
        END
      LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
    `;

    queryParams.push(Number(limit), offset);

    // Execute search query
    const result = await pool.query(baseQuery, queryParams);

    // Get total count
    const countResult = await pool.query(countQuery, queryParams.slice(0, -2));
    const totalCount = parseInt(countResult.rows[0].total);

    res.json({
      results: result.rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: totalCount,
        totalPages: Math.ceil(totalCount / Number(limit)),
      },
    });
  } catch (error) {
    console.error("Search error:", error);
    res.status(500).json({ error: "Search failed" });
  }
});

export default router;
