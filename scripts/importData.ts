// scripts/importData.ts
import { Pool } from "pg";
import fs from "fs";
import csv from "csv-parser";
import path from "path";

const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "code_db",
  password: "ahmad",
  port: 5432,
});

type ContentType =
  | "division"
  | "part"
  | "section"
  | "subsection"
  | "article"
  | "sentence"
  | "clause"
  | "subclause";

interface Reference {
  text: string;
  page: number;
  font: string;
  bbox: number[];
}

interface JsonRow {
  label: string;
  title: string;
  text: string;
  page: number;
  font: string;
  size: number;
  bbox: number[];
  y: number;
  references?: Reference[];
}

interface PdfDocumentParams {
  file_name: string;
  original_file_name: string;
  file_size: number;
  jurisdiction_id: number;
  document_type_id: number;
  language_id: number;
  title: string;
  year: number;
  version?: string;
  effective_date?: string;
  file_path?: string;
}

// Cache for content lookup to improve performance
const contentCache = new Map<
  string,
  {
    id: number;
    reference_code: string;
    title: string;
    content_text: string;
    is_definition: boolean;
    definition_term?: string;
  }
>();

// Store definition terms for quick lookup
const definitionTerms = new Map<string, number>();

const determineContentType = (label: string): ContentType => {
  const typeMap: { [key: string]: ContentType } = {
    Division: "division",
    Part: "part",
    Section: "section",
    Subsection: "subsection",
    Article: "article",
    Sentence: "sentence",
    Clause: "clause",
    Subclause: "subclause",
    Body: "part",
  };
  return typeMap[label] || "section";
};

const extractReferenceCode = (text: string, title: string): string => {
  if (title && /^[\d\.a-z\)]+$/.test(title.replace(/\s/g, ""))) {
    return title;
  }

  const patterns = [
    /^([\d\.]+)\s/,
    /^([a-z]\))\s/,
    /^(i+\))\s/,
    /^([A-Z]\))\s/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].replace(")", "");
    }
  }
  return "";
};

const extractTitle = (
  text: string,
  referenceCode: string,
  jsonTitle: string
): string => {
  if (jsonTitle && jsonTitle !== referenceCode) {
    return jsonTitle;
  }

  if (referenceCode) {
    return text
      .replace(referenceCode, "")
      .replace(/^[\.\)\s]*/, "")
      .replace(/\s*:\s*$/, "")
      .trim();
  }
  return text.trim();
};

// Check if content is a definition
const isDefinitionContent = (text: string, label: string): boolean => {
  // Articles and sentences that define terms are usually definitions
  if (label === "Article" || label === "Sentence") {
    const lowerText = text.toLowerCase();
    return (
      lowerText.includes("means") ||
      lowerText.includes("includes") ||
      lowerText.includes("defined as") ||
      /^[^.]*: [^.]*\.$/.test(text)
    ); // Pattern like "Term: definition."
  }
  return false;
};

// Extract definition term from definition content
const extractDefinitionTerm = (text: string): string | null => {
  // Patterns for definition extraction
  const patterns = [
    /^([^:]+):/, // "Term: definition"
    /^([^\.]+) means/, // "Term means definition"
    /^([^\.]+) includes/, // "Term includes definition"
    /^([^\.]+) is defined as/, // "Term is defined as definition"
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }
  return null;
};

// Function to create PDF document entry
const createPdfDocument = async (
  params: PdfDocumentParams
): Promise<string> => {
  const result = await pool.query(
    `INSERT INTO pdf_documents 
     (file_name, original_file_name, file_size, jurisdiction_id, 
      document_type_id, language_id, title, year, version, 
      effective_date, file_path, processing_status, processed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
     RETURNING id`,
    [
      params.file_name,
      params.original_file_name,
      params.file_size,
      params.jurisdiction_id,
      params.document_type_id,
      params.language_id,
      params.title,
      params.year,
      params.version || null,
      params.effective_date || null,
      params.file_path || null,
      "completed",
      new Date(),
    ]
  );

  return result.rows[0].id;
};

// Improved function to find target content for a reference
const findTargetContent = async (
  referenceText: string,
  pdfDocumentId: string
): Promise<{
  id: number;
  reference_code: string;
  hyperlink_target: string;
} | null> => {
  try {
    const cacheKey = `${pdfDocumentId}_${referenceText.toLowerCase()}`;

    // First, check if we have a direct definition term match
    if (definitionTerms.has(referenceText.toLowerCase())) {
      const definitionId = definitionTerms.get(referenceText.toLowerCase())!;
      const definitionContent = contentCache.get(
        `${pdfDocumentId}_id_${definitionId}`
      );
      if (definitionContent) {
        return {
          id: definitionContent.id,
          reference_code: definitionContent.reference_code || "",
          hyperlink_target: `#definition-${definitionContent.id}`,
        };
      }
    }

    // Try to find definition articles that match the reference text
    const definitionQuery = `
      SELECT id, reference_code, title, content_text, is_definition, definition_term
      FROM building_code_content 
      WHERE pdf_document_id = $1 
        AND is_definition = true
        AND (
          definition_term ILIKE $2 
          OR content_text ILIKE $3
          OR title ILIKE $2
        )
      ORDER BY 
        CASE 
          WHEN definition_term ILIKE $2 THEN 1
          WHEN content_text ILIKE $3 THEN 2
          WHEN title ILIKE $2 THEN 3
          ELSE 4
        END,
        sequence_order
      LIMIT 5
    `;

    const definitionResults = await pool.query(definitionQuery, [
      pdfDocumentId,
      `%${referenceText}%`,
      `%${referenceText} %`,
    ]);

    if (definitionResults.rows.length > 0) {
      const bestMatch = definitionResults.rows[0];
      return {
        id: bestMatch.id,
        reference_code: bestMatch.reference_code || "",
        hyperlink_target: `#definition-${bestMatch.id}`,
      };
    }

    // Fallback: find any relevant content
    const fallbackQuery = `
      SELECT id, reference_code, title, content_text
      FROM building_code_content 
      WHERE pdf_document_id = $1 
        AND (
          content_text ILIKE $2 
          OR title ILIKE $2
          OR reference_code = $3
        )
      ORDER BY 
        CASE 
          WHEN reference_code = $3 THEN 1
          WHEN content_text ILIKE $2 THEN 2
          ELSE 3
        END,
        sequence_order
      LIMIT 3
    `;

    const fallbackResults = await pool.query(fallbackQuery, [
      pdfDocumentId,
      `%${referenceText}%`,
      referenceText,
    ]);

    if (fallbackResults.rows.length > 0) {
      const result = fallbackResults.rows[0];
      return {
        id: result.id,
        reference_code: result.reference_code || "",
        hyperlink_target: `#content-${result.id}`,
      };
    }

    return null;
  } catch (error) {
    console.error(
      `Error finding target content for "${referenceText}":`,
      error
    );
    return null;
  }
};

const importJsonData = async (filePath: string, pdfDocumentId: string) => {
  const rawData = fs.readFileSync(filePath, "utf-8");
  const rows: JsonRow[] = JSON.parse(rawData);

  try {
    // Clear existing data for this document
    await pool.query(
      "DELETE FROM content_references WHERE source_content_id IN (SELECT id FROM building_code_content WHERE pdf_document_id = $1)",
      [pdfDocumentId]
    );
    await pool.query(
      "DELETE FROM building_code_content WHERE pdf_document_id = $1",
      [pdfDocumentId]
    );
    console.log("Cleared existing data for this document");

    let hierarchyStack: { type: ContentType; id: number }[] = [];
    let sequenceOrder = 0;

    const hierarchy: ContentType[] = [
      "division",
      "part",
      "section",
      "subsection",
      "article",
      "sentence",
      "clause",
      "subclause",
    ];

    // First pass: insert all content and identify definitions
    const contentMap = new Map<string, number>();

    for (const row of rows) {
      const contentType = determineContentType(row.label);
      const referenceCode = extractReferenceCode(row.text, row.title);
      const title = extractTitle(row.text, referenceCode, row.title);
      const pageNumber = row.page;

      // Check if this is definition content
      const isDefinition = isDefinitionContent(row.text, row.label);
      const definitionTerm = isDefinition
        ? extractDefinitionTerm(row.text)
        : null;

      console.log(`Processing: ${row.text.substring(0, 50)}...`);
      console.log(
        `  Type: ${contentType}, Ref: ${referenceCode}, Is Definition: ${isDefinition}`
      );

      // Determine parent based on hierarchy
      let parentId: number | null = null;
      for (let i = hierarchyStack.length - 1; i >= 0; i--) {
        const stackItem = hierarchyStack[i];
        const currentIndex = hierarchy.indexOf(contentType);
        const stackIndex = hierarchy.indexOf(stackItem.type);
        if (stackIndex < currentIndex) {
          parentId = stackItem.id;
          break;
        }
      }

      // Insert into database
      const result = await pool.query(
        `INSERT INTO building_code_content 
         (parent_id, content_type, page_number, reference_code, title, 
          content_text, sequence_order, pdf_document_id, font_family, font_size, 
          bbox, y_coordinate, is_definition, definition_term)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
        [
          parentId,
          contentType,
          pageNumber,
          referenceCode,
          title,
          row.text,
          sequenceOrder,
          pdfDocumentId,
          row.font,
          row.size,
          row.bbox,
          row.y,
          isDefinition,
          definitionTerm,
        ]
      );

      const newId = result.rows[0].id;

      // Store definition terms for reference resolution
      if (isDefinition && definitionTerm) {
        definitionTerms.set(definitionTerm.toLowerCase(), newId);
        console.log(`  ✓ Definition term: "${definitionTerm}"`);
      }

      // Store in content map
      const contentKey = `${row.text}_${pageNumber}`;
      contentMap.set(contentKey, newId);

      // Update hierarchy
      const currentIndex = hierarchy.indexOf(contentType);
      hierarchyStack = hierarchyStack.filter(
        (item) => hierarchy.indexOf(item.type) < currentIndex
      );
      hierarchyStack.push({ type: contentType, id: newId });
      sequenceOrder++;
    }

    console.log(`Successfully imported ${rows.length} content rows`);
    console.log(`Found ${definitionTerms.size} definition terms`);

    // Build content cache
    console.log("Building content cache for reference resolution...");
    const allContent = await pool.query(
      `SELECT id, reference_code, title, content_text, content_type, is_definition, definition_term
       FROM building_code_content 
       WHERE pdf_document_id = $1 
       ORDER BY sequence_order`,
      [pdfDocumentId]
    );

    allContent.rows.forEach((row) => {
      const cacheKey = `${pdfDocumentId}_${row.content_text}`;
      contentCache.set(cacheKey, row);

      if (row.reference_code) {
        const refCacheKey = `${pdfDocumentId}_${row.reference_code}`;
        contentCache.set(refCacheKey, row);
      }

      if (row.definition_term) {
        const termCacheKey = `${pdfDocumentId}_${row.definition_term.toLowerCase()}`;
        contentCache.set(termCacheKey, row);
      }
    });

    // Second pass: process references with hyperlink targets
    console.log("Processing references with hyperlink targets...");
    let referenceCount = 0;
    let unresolvedReferences = 0;

    for (const row of rows) {
      if (!row.references || row.references.length === 0) continue;

      const contentKey = `${row.text}_${row.page}`;
      const sourceContentId = contentMap.get(contentKey);

      if (!sourceContentId) {
        console.log(
          `Could not find source content for: ${row.text.substring(0, 50)}`
        );
        continue;
      }

      for (let i = 0; i < row.references.length; i++) {
        const reference = row.references[i];
        const targetContent = await findTargetContent(
          reference.text,
          pdfDocumentId
        );

        await pool.query(
          `INSERT INTO content_references 
           (source_content_id, target_content_id, reference_text, reference_type, 
            target_reference_code, page_number, font_family, bbox, hyperlink_target, reference_position)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            sourceContentId,
            targetContent?.id || null,
            reference.text,
            "definition", // Most references are to definitions
            targetContent?.reference_code || null,
            reference.page,
            reference.font,
            reference.bbox,
            targetContent?.hyperlink_target || null,
            i, // Position in the references array
          ]
        );

        referenceCount++;
        if (targetContent) {
          console.log(
            `  ✓ Reference: "${reference.text}" -> ${targetContent.hyperlink_target}`
          );
        } else {
          console.log(`  ✗ Unresolved: "${reference.text}"`);
          unresolvedReferences++;
        }
      }
    }

    console.log(`Successfully processed ${referenceCount} references`);
    console.log(`Unresolved references: ${unresolvedReferences}`);
  } catch (error) {
    console.error("Error during import:", error);
    throw error;
  }
};

// Main function to run the complete import process
const runCompleteImport = async () => {
  try {
    const jsonFilePath = path.join(__dirname, "merged_spans_sample.json");

    console.log("Creating PDF document entry...");
    const pdfDocumentId = await createPdfDocument({
      file_name: "national-building-code-2023-alberta.pdf",
      original_file_name: "National Building Code – 2023 Alberta Edition.pdf",
      file_size: fs.statSync(jsonFilePath).size,
      jurisdiction_id: 1,
      document_type_id: 1,
      language_id: 1,
      title: "National Building Code – 2023 Alberta Edition",
      year: 2023,
      version: "2023",
      effective_date: "2023-01-01",
      file_path: "/documents/national-building-code-2023-alberta.pdf",
    });

    console.log(`Created PDF document with ID: ${pdfDocumentId}`);
    await importJsonData(jsonFilePath, pdfDocumentId);
    console.log("Data import completed successfully");
  } catch (error) {
    console.error("Import process failed:", error);
    throw error;
  }
};

// Run the complete import process
runCompleteImport()
  .then(() => {
    console.log("Complete import process finished successfully");
    pool.end();
    process.exit(0);
  })
  .catch((error) => {
    console.error("Complete import process failed:", error);
    pool.end();
    process.exit(1);
  });
