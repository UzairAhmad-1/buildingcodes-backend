// src/routes/pdfDocuments.ts
import express from "express";
import { pool } from "../db";

const router = express.Router();

// Get all PDF documents with related data
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        pd.id,
        pd.file_name,
        pd.original_file_name,
        pd.file_size,
        pd.title,
        pd.year,
        pd.version,
        pd.effective_date,
        pd.processing_status,
        pd.processed_at,
        pd.file_path,
        pd.created_at,
        pd.updated_at,
        j.name as jurisdiction_name,
        j.code as jurisdiction_code,
        dt.name as document_type_name,
        l.name as language_name,
        l.code as language_code
      FROM pdf_documents pd
      LEFT JOIN jurisdictions j ON pd.jurisdiction_id = j.id
      LEFT JOIN document_types dt ON pd.document_type_id = dt.id
      LEFT JOIN languages l ON pd.language_id = l.id
      ORDER BY pd.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching PDF documents:", error);
    res.status(500).json({ error: "Failed to fetch PDF documents" });
  }
});

// Get PDF document by ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `
      SELECT 
        pd.id,
        pd.file_name,
        pd.original_file_name,
        pd.file_size,
        pd.title,
        pd.year,
        pd.version,
        pd.effective_date,
        pd.processing_status,
        pd.processed_at,
        pd.file_path,
        pd.created_at,
        pd.updated_at,
        j.name as jurisdiction_name,
        j.code as jurisdiction_code,
        dt.name as document_type_name,
        l.name as language_name,
        l.code as language_code
      FROM pdf_documents pd
      LEFT JOIN jurisdictions j ON pd.jurisdiction_id = j.id
      LEFT JOIN document_types dt ON pd.document_type_id = dt.id
      LEFT JOIN languages l ON pd.language_id = l.id
      WHERE pd.id = $1
    `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "PDF document not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching PDF document:", error);
    res.status(500).json({ error: "Failed to fetch PDF document" });
  }
});

// Get PDF documents by jurisdiction
router.get("/jurisdiction/:jurisdictionId", async (req, res) => {
  try {
    const { jurisdictionId } = req.params;
    const result = await pool.query(
      `
      SELECT 
        pd.id,
        pd.file_name,
        pd.original_file_name,
        pd.file_size,
        pd.title,
        pd.year,
        pd.version,
        pd.effective_date,
        pd.processing_status,
        pd.processed_at,
        pd.file_path,
        pd.created_at,
        pd.updated_at,
        j.name as jurisdiction_name,
        j.code as jurisdiction_code,
        dt.name as document_type_name,
        l.name as language_name,
        l.code as language_code
      FROM pdf_documents pd
      LEFT JOIN jurisdictions j ON pd.jurisdiction_id = j.id
      LEFT JOIN document_types dt ON pd.document_type_id = dt.id
      LEFT JOIN languages l ON pd.language_id = l.id
      WHERE pd.jurisdiction_id = $1
      ORDER BY pd.year DESC, pd.title
    `,
      [jurisdictionId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching PDF documents by jurisdiction:", error);
    res.status(500).json({ error: "Failed to fetch PDF documents" });
  }
});

// Get PDF documents by document type
router.get("/type/:documentTypeId", async (req, res) => {
  try {
    const { documentTypeId } = req.params;
    const result = await pool.query(
      `
      SELECT 
        pd.id,
        pd.file_name,
        pd.original_file_name,
        pd.file_size,
        pd.title,
        pd.year,
        pd.version,
        pd.effective_date,
        pd.processing_status,
        pd.processed_at,
        pd.file_path,
        pd.created_at,
        pd.updated_at,
        j.name as jurisdiction_name,
        j.code as jurisdiction_code,
        dt.name as document_type_name,
        l.name as language_name,
        l.code as language_code
      FROM pdf_documents pd
      LEFT JOIN jurisdictions j ON pd.jurisdiction_id = j.id
      LEFT JOIN document_types dt ON pd.document_type_id = dt.id
      LEFT JOIN languages l ON pd.language_id = l.id
      WHERE pd.document_type_id = $1
      ORDER BY pd.year DESC, pd.title
    `,
      [documentTypeId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching PDF documents by type:", error);
    res.status(500).json({ error: "Failed to fetch PDF documents" });
  }
});

// Get building code content for a specific PDF document
// In your backend routes
router.get("/:id/content", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
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
          pdf_document_id,
          ARRAY[sequence_order] as path
        FROM building_code_content 
        WHERE parent_id IS NULL AND pdf_document_id = $1
        
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
          c.pdf_document_id,
          ct.path || c.sequence_order
        FROM building_code_content c
        JOIN content_tree ct ON c.parent_id = ct.id
      )
      SELECT * FROM content_tree 
      ORDER BY path;
    `,
      [id]
    );

    res.json({
      documentId: id,
      content: result.rows,
    });
  } catch (error) {
    console.error("Error fetching document content:", error);
    res.status(500).json({ error: "Failed to fetch document content" });
  }
});
export default router;
