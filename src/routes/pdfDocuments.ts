// src/routes/pdfDocuments.ts
import express from "express";
import { pool } from "../db";
import { upload } from "../middleware/upload";
import { authenticateToken, AuthRequest } from "../middleware/auth";
import fs from "fs";

const router = express.Router();

// Upload PDF document
router.post(
  "/upload",
  authenticateToken,
  upload.single("pdf"),
  async (req: AuthRequest, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No PDF file uploaded" });
      }

      const {
        title,
        year,
        version,
        effective_date,
        jurisdiction_id,
        document_type_id,
        language_id,
      } = req.body;

      // Validate required fields
      if (
        !title ||
        !year ||
        !jurisdiction_id ||
        !document_type_id ||
        !language_id
      ) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({
          error:
            "Title, year, jurisdiction, document type, and language are required",
        });
      }

      console.log("File uploaded to:", req.file.path);
      console.log("File name:", req.file.filename);

      // Insert into database - store ONLY the filename
      const result = await pool.query(
        `INSERT INTO pdf_documents (
        file_name, original_file_name, file_size, file_path,
        title, year, version, effective_date,
        jurisdiction_id, document_type_id, language_id,
        processing_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
        [
          req.file.filename, // Store only the filename
          req.file.originalname,
          req.file.size,
          req.file.filename, // Use filename as file_path too
          title,
          parseInt(year),
          version || null,
          effective_date || null,
          parseInt(jurisdiction_id),
          parseInt(document_type_id),
          parseInt(language_id),
          "uploaded",
        ]
      );

      const uploadedDocument = result.rows[0];

      res.status(201).json({
        message: "PDF uploaded successfully",
        document: uploadedDocument,
      });
    } catch (error) {
      console.error("Upload error:", error);

      if (req.file) {
        fs.unlinkSync(req.file.path);
      }

      res.status(500).json({ error: "Failed to upload PDF document" });
    }
  }
);

// Delete PDF document
router.delete("/:id", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params;

    // First get the document to find the file path
    const documentResult = await pool.query(
      "SELECT file_path FROM pdf_documents WHERE id = $1",
      [id]
    );

    if (documentResult.rows.length === 0) {
      return res.status(404).json({ error: "PDF document not found" });
    }

    const filePath = documentResult.rows[0].file_path;

    // Delete from database
    await pool.query("DELETE FROM pdf_documents WHERE id = $1", [id]);

    // Delete the file
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    res.json({ message: "PDF document deleted successfully" });
  } catch (error) {
    console.error("Delete error:", error);
    res.status(500).json({ error: "Failed to delete PDF document" });
  }
});
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
// Updated API Route to Include References
const getDocumentContentWithReferences = async (documentId: string) => {
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
        font_family,
        font_size,
        bbox,
        y_coordinate,
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
        c.font_family,
        c.font_size,
        c.bbox,
        c.y_coordinate,
        ct.path || c.sequence_order
      FROM building_code_content c
      JOIN content_tree ct ON c.parent_id = ct.id
    )
    SELECT 
      ct.*,
      COALESCE(
        json_agg(
          json_build_object(
            'id', cr.id,
            'reference_text', cr.reference_text,
            'reference_type', cr.reference_type,
            'target_content_id', cr.target_content_id,
            'target_reference_code', cr.target_reference_code,
            'hyperlink_target', cr.hyperlink_target,
            'page_number', cr.page_number,
            'font_family', cr.font_family,
            'bbox', cr.bbox,
            'reference_position', cr.reference_position
          ) ORDER BY cr.reference_position
        ) FILTER (WHERE cr.id IS NOT NULL),
        '[]'::json
      ) as references
    FROM content_tree ct
    LEFT JOIN content_references cr ON ct.id = cr.source_content_id
    GROUP BY 
      ct.id, ct.parent_id, ct.content_type, ct.page_number, 
      ct.reference_code, ct.title, ct.content_text, ct.sequence_order,
      ct.pdf_document_id, ct.font_family, ct.font_size, ct.bbox, 
      ct.y_coordinate, ct.path
    ORDER BY ct.path;
    `,
    [documentId]
  );

  return result.rows;
};

// Updated Router
router.get("/:id/content", async (req, res) => {
  try {
    const { id } = req.params;

    const content = await getDocumentContentWithReferences(id);

    res.json({
      documentId: id,
      content: content,
    });
  } catch (error) {
    console.error("Error fetching document content:", error);
    res.status(500).json({ error: "Failed to fetch document content" });
  }
});
// Add this to your server.ts or pdfDocuments.ts
router.get("/debug/file-check/:filename", async (req, res) => {
  try {
    const { filename } = req.params;
    const fs = require("fs");
    const path = require("path");

    const uploadsDir = path.join(process.cwd(), "uploads");
    const filePath = path.join(uploadsDir, filename);

    console.log("Looking for file:", filePath);

    if (fs.existsSync(filePath)) {
      res.json({
        exists: true,
        filename: filename,
        fullPath: filePath,
        url: `http://localhost:3001/uploads/${filename}`,
        fileSize: fs.statSync(filePath).size,
      });
    } else {
      res.json({
        exists: false,
        filename: filename,
        fullPath: filePath,
        error: "File not found on disk",
      });
    }
  } catch (error) {
    // res.status(500).json({ error: error.message });
  }
});
export default router;
