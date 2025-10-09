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

interface CsvRow {
  page: string;
  text: string;
  label: string;
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

const extractReferenceCode = (text: string): string => {
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

const extractTitle = (text: string, referenceCode: string): string => {
  if (referenceCode) {
    return text
      .replace(referenceCode, "")
      .replace(/^[\.\)\s]*/, "")
      .replace(/\s*:\s*$/, "")
      .trim();
  }
  return text.trim();
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
      "completed", // Mark as completed since we're importing data
      new Date(), // Set processed_at to now
    ]
  );

  return result.rows[0].id;
};

const importCsvData = async (filePath: string, pdfDocumentId: string) => {
  const rows: CsvRow[] = [];

  return new Promise<void>((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", (data) => rows.push(data))
      .on("end", async () => {
        try {
          // Clear existing data for this document (optional - remove if you want to keep multiple documents)
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

          for (const row of rows) {
            const contentType = determineContentType(row.label);
            const referenceCode = extractReferenceCode(row.text);
            const title = extractTitle(row.text, referenceCode);
            const pageNumber = parseInt(row.page) || 0;

            console.log(`Processing: ${row.text.substring(0, 50)}...`);
            console.log(`  Type: ${contentType}, Ref: ${referenceCode}`);

            // Determine parent based on hierarchy
            let parentId: number | null = null;

            // Find the appropriate parent in the stack (from highest to lowest level)
            for (let i = hierarchyStack.length - 1; i >= 0; i--) {
              const stackItem = hierarchyStack[i];
              const currentIndex = hierarchy.indexOf(contentType);
              const stackIndex = hierarchy.indexOf(stackItem.type);

              if (stackIndex < currentIndex) {
                parentId = stackItem.id;
                break;
              }
            }

            // Insert into database with pdf_document_id
            const result = await pool.query(
              `INSERT INTO building_code_content 
               (parent_id, content_type, page_number, reference_code, title, 
                content_text, sequence_order, pdf_document_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
              [
                parentId,
                contentType,
                pageNumber,
                referenceCode,
                title,
                row.text,
                sequenceOrder,
                pdfDocumentId, // Add the PDF document ID
              ]
            );

            const newId = result.rows[0].id;

            // Update hierarchy stack - remove items that are at same or lower level
            const currentIndex = hierarchy.indexOf(contentType);
            hierarchyStack = hierarchyStack.filter(
              (item) => hierarchy.indexOf(item.type) < currentIndex
            );

            // Add current item to stack
            hierarchyStack.push({ type: contentType, id: newId });
            sequenceOrder++;
          }

          console.log(
            `Successfully imported ${rows.length} rows with pdf_document_id: ${pdfDocumentId}`
          );
          resolve();
        } catch (error) {
          console.error("Error during import:", error);
          reject(error);
        }
      })
      .on("error", (error) => {
        console.error("CSV read error:", error);
        reject(error);
      });
  });
};

// Main function to run the complete import process
const runCompleteImport = async () => {
  try {
    const csvFilePath = path.join(__dirname, "data-sample-british.csv");

    // First, create PDF document entry
    console.log("Creating PDF document entry...");

    const pdfDocumentId = await createPdfDocument({
      file_name: "british-columbia-building-code-2023.pdf",
      original_file_name: "data-sample-british.csv",
      file_size: fs.statSync(csvFilePath).size,
      jurisdiction_id: 3, // British Columbia
      document_type_id: 1, // Codes
      language_id: 1, // English
      title: "British Columbia Building Code 2023",
      year: 2023,
      version: "2023",
      effective_date: "2023-01-01",
      file_path: "/documents/bc-building-code-2023.pdf",
    });

    console.log(`Created PDF document with ID: ${pdfDocumentId}`);

    // Then import CSV data with the PDF document ID
    await importCsvData(csvFilePath, pdfDocumentId);

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
