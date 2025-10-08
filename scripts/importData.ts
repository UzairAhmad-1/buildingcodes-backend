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
  // Handle different reference code patterns
  const patterns = [
    /^([\d\.]+)\s/, // 1.1.1.1
    /^([a-z]\))\s/, // a)
    /^(i+\))\s/, // i), ii), iii)
    /^([A-Z]\))\s/, // A)
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
    // Remove the reference code and any following dots/parentheses
    return text
      .replace(referenceCode, "")
      .replace(/^[\.\)\s]*/, "")
      .replace(/\s*:\s*$/, "")
      .trim();
  }
  return text.trim();
};

const importCsvData = async (filePath: string) => {
  const rows: CsvRow[] = [];

  return new Promise<void>((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on("data", (data) => rows.push(data))
      .on("end", async () => {
        try {
          // Clear existing data
          await pool.query("DELETE FROM building_code_content");
          console.log("Cleared existing data");

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

            // Insert into database
            const result = await pool.query(
              `INSERT INTO building_code_content 
               (parent_id, content_type, page_number, reference_code, title, content_text, sequence_order)
               VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
              [
                parentId,
                contentType,
                pageNumber,
                referenceCode,
                title,
                row.text,
                sequenceOrder,
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

          console.log(`Successfully imported ${rows.length} rows`);
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

// Run the import
const csvFilePath = path.join(__dirname, "data-sample-british.csv");

importCsvData(csvFilePath)
  .then(() => {
    console.log("Data import completed successfully");
    pool.end();
    process.exit(0);
  })
  .catch((error) => {
    console.error("Data import failed:", error);
    pool.end();
    process.exit(1);
  });
