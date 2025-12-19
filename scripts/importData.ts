// scripts/importData.ts
import { PrismaClient, ContentType } from "@prisma/client";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient();

interface Reference {
  text: string;
  page: number;
  font: string;
  bbox: number[];
  link_text: string;
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
  term?: string;
}

interface PdfDocumentParams {
  file_name: string;
  original_file_name: string;
  file_size: number;
  jurisdiction_name: string;
  document_type_name: string;
  language_code: string;
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
    reference_code: string | null;
    content_text: string;
    is_definition: boolean;
    definition_term?: string | null;
  }
>();

// Store definition terms for quick lookup
const definitionTerms = new Map<string, number>();

// Database lookup cache
let dbCache: {
  jurisdictions: Map<string, number>;
  documentTypes: Map<string, number>;
  languages: Map<string, number>;
} = {
  jurisdictions: new Map(),
  documentTypes: new Map(),
  languages: new Map(),
};

// Initialize database cache
const initializeDbCache = async () => {
  console.log("🔍 Initializing database cache...");

  // Load jurisdictions
  const jurisdictions = await prisma.jurisdiction.findMany();
  dbCache.jurisdictions.clear();
  jurisdictions.forEach((j) => {
    dbCache.jurisdictions.set(j.name.toLowerCase(), j.id);
    dbCache.jurisdictions.set(j.code.toLowerCase(), j.id);
    console.log(`  Jurisdiction: ${j.name} (${j.code}) -> ID: ${j.id}`);
  });

  // Load document types
  const documentTypes = await prisma.documentType.findMany();
  dbCache.documentTypes.clear();
  documentTypes.forEach((dt) => {
    dbCache.documentTypes.set(dt.name.toLowerCase(), dt.id);
    console.log(`  Document Type: ${dt.name} -> ID: ${dt.id}`);
  });

  // Load languages
  const languages = await prisma.language.findMany();
  dbCache.languages.clear();
  languages.forEach((l) => {
    dbCache.languages.set(l.code.toLowerCase(), l.id);
    dbCache.languages.set(l.name.toLowerCase(), l.id);
    console.log(`  Language: ${l.name} (${l.code}) -> ID: ${l.id}`);
  });

  console.log("✅ Database cache initialized");
};

const determineContentType = (label: string): ContentType | null => {
  const typeMap: { [key: string]: ContentType } = {
    Division: ContentType.division,
    Part: ContentType.part,
    Section: ContentType.section,
    Subsection: ContentType.subsection,
    Article: ContentType.article,
    Sentence: ContentType.sentence,
    Clause: ContentType.clause,
    Subclause: ContentType.subclause,
    Body: ContentType.part,
    SeeAlso: ContentType.see_also,
    DefTerm: ContentType.definition,
    // New note types
    NoteSection: ContentType.note_section,
    NoteItem: ContentType.note_item,
    NoteContent: ContentType.note_content,
  };

  // Skip Table labels
  if (label === "Table" || label === "Symbol") {
    return null;
  }

  return typeMap[label] || ContentType.section;
};

const extractReferenceCode = (
  title: string,
  text: string,
  label: string
): string => {
  // For NoteSection and NoteItem, always use title as reference code
  if ((label === "NoteSection" || label === "NoteItem") && title) {
    return title.trim();
  }

  // For DefTerm, use term if available (this comes from the title parameter)
  if (label === "DefTerm" && title) {
    return title.trim();
  }

  // For high-level structural elements (Division, Part, Section), use title as reference code
  const structuralElements = [
    "Division",
    "Part",
    "Section",
    "Subsection",
    "Article",
  ];
  if (structuralElements.includes(label) && title) {
    return title.trim();
  }

  // For NoteContent, use empty reference code
  if (label === "NoteContent") {
    return "";
  }

  // For Sentence, check if we should use title or text
  if (label === "Sentence") {
    // If title exists and text is empty, use title as content, not reference code
    if (title && (!text || text.trim() === "")) {
      return "";
    }
    // If both title and text exist, use title pattern as reference code if it matches
    if (title && /^[\d\.\)]+$/.test(title.replace(/\s/g, ""))) {
      return title.trim();
    }
  }

  // Use title as reference code if it matches pattern - FIXED: added \( to pattern
  if (title && /^[\d\.a-z\(\)\-]+$/.test(title.replace(/\s/g, ""))) {
    return title.trim();
  }

  // Extract from text as fallback only for certain types
  const extractFromTextTypes = ["Clause", "Subclause", "Sentence"];
  if (extractFromTextTypes.includes(label)) {
    const patterns = [
      /^([\d\.\-]+)\s/,
      /^([a-z]\))\s/,
      /^(i+\))\s/,
      /^([A-Z]\))\s/,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1].replace(")", "").trim();
      }
    }
  }

  return "";
};

const extractContentText = (
  text: string,
  title: string,
  referenceCode: string,
  label: string
): string => {
  // For NoteSection and NoteItem, use text as content text (title goes to reference code)
  if (label === "NoteSection" || label === "NoteItem") {
    return text.trim();
  }

  // For DefTerm, use the text as content text (term goes to title/reference code)
  if (label === "DefTerm") {
    return text.trim();
  }

  // For Sentence where title exists but text is empty, use title as content
  if (label === "Sentence" && title && (!text || text.trim() === "")) {
    return title.trim();
  }

  // For SeeAlso, use the text as-is
  if (label === "SeeAlso") {
    return text.trim();
  }

  // For NoteContent, use the text as-is
  if (label === "NoteContent") {
    return text.trim();
  }

  // For high-level structural elements, use text as content
  const structuralElements = [
    "Division",
    "Part",
    "Section",
    "Subsection",
    "Article",
  ];
  if (structuralElements.includes(label)) {
    return text.trim();
  }

  // Remove reference code from text if present
  if (referenceCode && text.startsWith(referenceCode)) {
    return text
      .replace(referenceCode, "")
      .replace(/^[\.\)\s]*/, "")
      .replace(/\s*:\s*$/, "")
      .trim();
  }

  // If text is empty but title has content, use title
  if ((!text || text.trim() === "") && title && title.trim() !== "") {
    return title.trim();
  }

  return text.trim();
};

// Check if content is a definition
const isDefinitionContent = (text: string, label: string): boolean => {
  // DefTerm is always a definition
  if (label === "DefTerm") {
    return true;
  }

  // Articles and sentences that define terms are usually definitions
  if (label === "Article" || label === "Sentence") {
    const lowerText = text.toLowerCase();
    return (
      lowerText.includes("means") ||
      lowerText.includes("includes") ||
      lowerText.includes("defined as") ||
      /^[^.]*: [^.]*\.$/.test(text)
    );
  }
  return false;
};

const extractDefinitionTerm = (
  text: string,
  label: string,
  jsonTitle?: string,
  jsonTerm?: string // Add this parameter
): string | null => {
  // For DefTerm, use the provided term field or extract from text
  if (label === "DefTerm") {
    // First priority: use the explicit term field from JSON
    if (jsonTerm) {
      return jsonTerm;
    }
    // Second priority: use the title field
    if (jsonTitle) {
      return jsonTitle;
    }
    // Fallback: extract term from DefTerm text pattern: "Term means definition"
    const match = text.match(/^([^,]+?)\s+means/);
    if (match) {
      return match[1].trim();
    }
    return text.split(" means")[0]?.trim() || null;
  }

  // Patterns for definition extraction for other content types
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
// Function to create PDF document entry using names instead of IDs
const createPdfDocument = async (
  params: PdfDocumentParams
): Promise<string> => {
  // Look up jurisdiction ID
  const jurisdictionId = dbCache.jurisdictions.get(
    params.jurisdiction_name.toLowerCase()
  );
  if (!jurisdictionId) {
    const availableJurisdictions = Array.from(dbCache.jurisdictions.entries())
      .filter(([key]) => key.length > 2)
      .map(([key, id]) => `${key} (ID: ${id})`)
      .join(", ");
    throw new Error(
      `Jurisdiction "${params.jurisdiction_name}" not found. Available: ${availableJurisdictions}`
    );
  }

  // Look up document type ID
  const documentTypeId = dbCache.documentTypes.get(
    params.document_type_name.toLowerCase()
  );
  if (!documentTypeId) {
    const availableTypes = Array.from(dbCache.documentTypes.entries())
      .map(([key, id]) => `${key} (ID: ${id})`)
      .join(", ");
    throw new Error(
      `Document type "${params.document_type_name}" not found. Available: ${availableTypes}`
    );
  }

  // Look up language ID
  const languageId = dbCache.languages.get(params.language_code.toLowerCase());
  if (!languageId) {
    const availableLanguages = Array.from(dbCache.languages.entries())
      .map(([key, id]) => `${key} (ID: ${id})`)
      .join(", ");
    throw new Error(
      `Language "${params.language_code}" not found. Available: ${availableLanguages}`
    );
  }

  console.log(`📄 Creating PDF document with:`);
  console.log(
    `   Jurisdiction: ${params.jurisdiction_name} (ID: ${jurisdictionId})`
  );
  console.log(
    `   Document Type: ${params.document_type_name} (ID: ${documentTypeId})`
  );
  console.log(`   Language: ${params.language_code} (ID: ${languageId})`);

  const pdfDocument = await prisma.pdfDocument.create({
    data: {
      fileName: params.file_name,
      originalFileName: params.original_file_name,
      fileSize: BigInt(params.file_size),
      jurisdictionId: jurisdictionId,
      documentTypeId: documentTypeId,
      languageId: languageId,
      title: params.title,
      year: params.year,
      version: params.version || null,
      effectiveDate: params.effective_date
        ? new Date(params.effective_date)
        : null,
      filePath: params.file_path || null,
      processingStatus: "completed",
      processedAt: new Date(),
    },
  });

  return pdfDocument.id;
};

// Improved function to find target content for a reference using Prisma
const findTargetContent = async (
  referenceText: string,
  pdfDocumentId: string
): Promise<{
  id: number;
  reference_code: string | null;
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
          reference_code: definitionContent.reference_code || null,
          hyperlink_target: `#definition-${definitionContent.id}`,
        };
      }
    }

    // Try to find definition articles that match the reference text using Prisma
    const definitionResults = await prisma.buildingCodeContent.findMany({
      where: {
        pdfDocumentId: pdfDocumentId,
        isDefinition: true,
        OR: [
          { definitionTerm: { contains: referenceText, mode: "insensitive" } },
          {
            contentText: { contains: `${referenceText} `, mode: "insensitive" },
          },
          { referenceCode: referenceText },
        ],
      },
      orderBy: [{ definitionTerm: "asc" }, { sequenceOrder: "asc" }],
      take: 5,
    });

    if (definitionResults.length > 0) {
      const bestMatch = definitionResults[0];
      return {
        id: bestMatch.id,
        reference_code: bestMatch.referenceCode,
        hyperlink_target: `#definition-${bestMatch.id}`,
      };
    }

    // Fallback: find any relevant content
    const fallbackResults = await prisma.buildingCodeContent.findMany({
      where: {
        pdfDocumentId: pdfDocumentId,
        OR: [
          { contentText: { contains: referenceText, mode: "insensitive" } },
          { referenceCode: referenceText },
        ],
      },
      orderBy: [{ referenceCode: "asc" }, { sequenceOrder: "asc" }],
      take: 3,
    });

    if (fallbackResults.length > 0) {
      const result = fallbackResults[0];
      return {
        id: result.id,
        reference_code: result.referenceCode,
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
    // Clear existing data for this document using Prisma
    await prisma.contentReference.deleteMany({
      where: {
        sourceContent: {
          pdfDocumentId: pdfDocumentId,
        },
      },
    });

    await prisma.buildingCodeContent.deleteMany({
      where: {
        pdfDocumentId: pdfDocumentId,
      },
    });

    console.log("🧹 Cleared existing data for this document");

    let hierarchyStack: { type: ContentType; id: number }[] = [];
    let sequenceOrder = 0;

    const hierarchy: ContentType[] = [
      ContentType.division,
      ContentType.part,
      ContentType.section,
      ContentType.note_section, // NoteSection at same level as Section (siblings under Part)
      ContentType.subsection,
      ContentType.note_item, // NoteItem at same level as Subsection
      ContentType.article,
      ContentType.sentence,
      ContentType.clause,
      ContentType.subclause,
      ContentType.see_also,
      ContentType.definition,
      ContentType.note_content, // NoteContent at bottom level
      ContentType.paragraph,
    ];

    // Track the current definition that clauses should be attached to
    let currentDefinitionId: number | null = null;
    // Track the current sentence that definitions should be attached to
    let currentSentenceId: number | null = null;
    // Track the current note section for note items
    let currentNoteSectionId: number | null = null;
    // Track the current note item for note content
    let currentNoteItemId: number | null = null;

    // First pass: insert all content and identify definitions
    const contentMap = new Map<string, number>();

    for (const row of rows) {
      const contentType = determineContentType(row.label);

      // Skip Table labels and any other null content types
      if (contentType === null) {
        console.log(`⏭️  Skipping Table: ${row.text.substring(0, 50)}...`);
        continue;
      }

      const referenceCode = extractReferenceCode(
        row.title,
        row.text,
        row.label
      );
      const contentText = extractContentText(
        row.text,
        row.title,
        referenceCode,
        row.label
      );

      const pageNumber = row.page;

      // Check if this is definition content
      const isDefinition = isDefinitionContent(contentText, row.label);
      const definitionTerm = isDefinition
        ? extractDefinitionTerm(contentText, row.label, row.title, row.term) // Add row.term here
        : null;

      console.log(`Processing: ${contentText.substring(0, 50)}...`);
      console.log(
        `  Type: ${contentType}, Label: ${row.label}, Ref: ${referenceCode}, Is Definition: ${isDefinition}`
      );

      let parentId: number | null = null;

      // Handle hierarchy based on content type and label
      if (contentType === ContentType.see_also) {
        // SeeAlso should be attached to the most recent content item
        if (hierarchyStack.length > 0) {
          parentId = hierarchyStack[hierarchyStack.length - 1].id;
        }
      } else if (contentType === ContentType.note_section) {
        // NoteSection starts a new section hierarchy - reset note tracking
        currentNoteSectionId = null;
        currentNoteItemId = null;

        // NoteSection should be a direct child of Part (same as Section)
        // Find the most recent Part in the hierarchy stack
        for (let i = hierarchyStack.length - 1; i >= 0; i--) {
          const stackItem = hierarchyStack[i];
          if (stackItem.type === ContentType.part) {
            parentId = stackItem.id;
            console.log(`  → Attaching NoteSection to Part ID: ${parentId}`);
            break;
          }
        }

        // If no Part found, fallback to hierarchy-based parent finding
        if (!parentId) {
          for (let i = hierarchyStack.length - 1; i >= 0; i--) {
            const stackItem = hierarchyStack[i];
            const currentIndex = hierarchy.indexOf(contentType);
            const stackIndex = hierarchy.indexOf(stackItem.type);
            if (stackIndex < currentIndex) {
              parentId = stackItem.id;
              break;
            }
          }
        }
      } else if (contentType === ContentType.note_item) {
        // NoteItem should be child of current NoteSection
        if (currentNoteSectionId) {
          parentId = currentNoteSectionId;
          console.log(
            `  → Attaching NoteItem to NoteSection ID: ${currentNoteSectionId}`
          );
        } else {
          // Fallback: find parent from hierarchy (should be a NoteSection)
          for (let i = hierarchyStack.length - 1; i >= 0; i--) {
            const stackItem = hierarchyStack[i];
            if (stackItem.type === ContentType.note_section) {
              parentId = stackItem.id;
              console.log(
                `  → Attaching NoteItem to NoteSection ID: ${parentId} (fallback)`
              );
              break;
            }
          }

          // If no NoteSection found, use hierarchy-based parent finding
          if (!parentId) {
            for (let i = hierarchyStack.length - 1; i >= 0; i--) {
              const stackItem = hierarchyStack[i];
              const currentIndex = hierarchy.indexOf(contentType);
              const stackIndex = hierarchy.indexOf(stackItem.type);
              if (stackIndex < currentIndex) {
                parentId = stackItem.id;
                break;
              }
            }
          }
        }
      } else if (contentType === ContentType.note_content) {
        // NoteContent should be child of current NoteItem
        if (currentNoteItemId) {
          parentId = currentNoteItemId;
          console.log(
            `  → Attaching NoteContent to NoteItem ID: ${currentNoteItemId}`
          );
        } else if (currentNoteSectionId) {
          // Fallback: attach to NoteSection if no NoteItem
          parentId = currentNoteSectionId;
          console.log(
            `  → Attaching NoteContent to NoteSection ID: ${currentNoteSectionId}`
          );
        } else {
          // Final fallback: find parent from hierarchy
          for (let i = hierarchyStack.length - 1; i >= 0; i--) {
            const stackItem = hierarchyStack[i];
            const currentIndex = hierarchy.indexOf(contentType);
            const stackIndex = hierarchy.indexOf(stackItem.type);
            if (stackIndex < currentIndex) {
              parentId = stackItem.id;
              break;
            }
          }
        }
      } else if (contentType === ContentType.sentence) {
        // Sentence - find parent from hierarchy and set as current sentence
        for (let i = hierarchyStack.length - 1; i >= 0; i--) {
          const stackItem = hierarchyStack[i];
          const currentIndex = hierarchy.indexOf(contentType);
          const stackIndex = hierarchy.indexOf(stackItem.type);
          if (stackIndex < currentIndex) {
            parentId = stackItem.id;
            break;
          }
        }
        // Reset current definition when we encounter a new sentence
        currentDefinitionId = null;
      } else if (contentType === ContentType.definition) {
        // Definition - should be child of current sentence
        if (currentSentenceId) {
          parentId = currentSentenceId;
          console.log(
            `  → Attaching definition to sentence ID: ${currentSentenceId}`
          );
        } else {
          // Fallback: find parent from hierarchy
          for (let i = hierarchyStack.length - 1; i >= 0; i--) {
            const stackItem = hierarchyStack[i];
            const currentIndex = hierarchy.indexOf(contentType);
            const stackIndex = hierarchy.indexOf(stackItem.type);
            if (stackIndex < currentIndex) {
              parentId = stackItem.id;
              break;
            }
          }
        }
      } else if (
        contentType === ContentType.clause ||
        contentType === ContentType.subclause
      ) {
        // Clauses and subclauses between definitions should be part of the current definition
        if (currentDefinitionId) {
          parentId = currentDefinitionId;
          console.log(
            `  → Attaching clause to definition ID: ${currentDefinitionId}`
          );
        } else {
          // If no current definition, find parent from hierarchy
          for (let i = hierarchyStack.length - 1; i >= 0; i--) {
            const stackItem = hierarchyStack[i];
            const currentIndex = hierarchy.indexOf(contentType);
            const stackIndex = hierarchy.indexOf(stackItem.type);
            if (stackIndex < currentIndex) {
              parentId = stackItem.id;
              break;
            }
          }
        }
      } else {
        // Regular content - find parent from hierarchy
        for (let i = hierarchyStack.length - 1; i >= 0; i--) {
          const stackItem = hierarchyStack[i];
          const currentIndex = hierarchy.indexOf(contentType);
          const stackIndex = hierarchy.indexOf(stackItem.type);
          if (stackIndex < currentIndex) {
            parentId = stackItem.id;
            break;
          }
        }
      }

      // Insert into database using Prisma WITHOUT font, bbox, yCoordinate and WITHOUT title column
      const newContent = await prisma.buildingCodeContent.create({
        data: {
          parentId: parentId,
          contentType: contentType,
          pageNumber: pageNumber,
          referenceCode: referenceCode || null,
          title: null, // Title column is not used - all content goes in contentText
          contentText: contentText,
          sequenceOrder: sequenceOrder,
          pdfDocumentId: pdfDocumentId,
          // Removed: fontFamily, fontSize, bbox, yCoordinate
          isDefinition: isDefinition,
          definitionTerm: definitionTerm,
        },
      });

      const newId: number = newContent.id;

      // Store definition terms for reference resolution
      if (isDefinition && definitionTerm) {
        definitionTerms.set(definitionTerm.toLowerCase(), newId);
        console.log(`  ✓ Definition term: "${definitionTerm}"`);

        // Set as current definition for subsequent clauses
        currentDefinitionId = newId;
        console.log(`  → Set as current definition ID: ${currentDefinitionId}`);
      } else if (contentType === ContentType.definition) {
        // For definition content without a specific term, still set as current definition
        currentDefinitionId = newId;
        console.log(`  → Set as current definition ID: ${currentDefinitionId}`);
      }

      // Track current sentence
      if (contentType === ContentType.sentence) {
        currentSentenceId = newId;
        console.log(`  → Set as current sentence ID: ${currentSentenceId}`);
      }

      // Track note hierarchy
      if (contentType === ContentType.note_section) {
        currentNoteSectionId = newId;
        console.log(
          `  → Set as current NoteSection ID: ${currentNoteSectionId}`
        );
      } else if (contentType === ContentType.note_item) {
        currentNoteItemId = newId;
        console.log(`  → Set as current NoteItem ID: ${currentNoteItemId}`);
      }

      // Store in content map
      const contentKey = `${contentText}_${pageNumber}`;
      contentMap.set(contentKey, newId);

      // Update hierarchy (don't push SeeAlso to stack as it doesn't create new hierarchy levels)
      if (
        contentType !== ContentType.see_also &&
        contentType !== ContentType.note_content
      ) {
        const currentIndex = hierarchy.indexOf(contentType);

        // Filter out items that are lower or equal in hierarchy
        hierarchyStack = hierarchyStack.filter((item) => {
          const itemIndex = hierarchy.indexOf(item.type);
          return itemIndex < currentIndex;
        });

        hierarchyStack.push({ type: contentType, id: newId });

        console.log(
          `  → Updated hierarchy stack: [${hierarchyStack
            .map((item) => ContentType[item.type])
            .join(", ")}]`
        );
      }

      sequenceOrder++;
    }

    console.log(
      `✅ Successfully imported ${contentMap.size} content rows (skipped ${
        rows.length - contentMap.size
      } tables)`
    );
    console.log(`📚 Found ${definitionTerms.size} definition terms`);

    // Build content cache using Prisma
    console.log("🔍 Building content cache for reference resolution...");
    const allContent = await prisma.buildingCodeContent.findMany({
      where: {
        pdfDocumentId: pdfDocumentId,
      },
      select: {
        id: true,
        referenceCode: true,
        contentText: true,
        contentType: true,
        isDefinition: true,
        definitionTerm: true,
      },
      orderBy: {
        sequenceOrder: "asc",
      },
    });

    allContent.forEach((row) => {
      const cacheKey = `${pdfDocumentId}_${row.contentText}`;
      contentCache.set(cacheKey, {
        id: row.id,
        reference_code: row.referenceCode,
        content_text: row.contentText,
        is_definition: row.isDefinition,
        definition_term: row.definitionTerm,
      });

      if (row.referenceCode) {
        const refCacheKey = `${pdfDocumentId}_${row.referenceCode}`;
        contentCache.set(refCacheKey, {
          id: row.id,
          reference_code: row.referenceCode,
          content_text: row.contentText,
          is_definition: row.isDefinition,
          definition_term: row.definitionTerm,
        });
      }

      if (row.definitionTerm) {
        const termCacheKey = `${pdfDocumentId}_${row.definitionTerm.toLowerCase()}`;
        contentCache.set(termCacheKey, {
          id: row.id,
          reference_code: row.referenceCode,
          content_text: row.contentText,
          is_definition: row.isDefinition,
          definition_term: row.definitionTerm,
        });
      }
    });

    // Second pass: process references with hyperlink targets using Prisma
    console.log("🔗 Processing references with hyperlink targets...");
    let referenceCount = 0;
    let unresolvedReferences = 0;

    for (const row of rows) {
      if (!row.references || row.references.length === 0) continue;

      const contentKey = `${row.text}_${row.page}`;
      const sourceContentId = contentMap.get(contentKey);

      if (!sourceContentId) {
        // This might be a table that was skipped, so skip its references too
        continue;
      }

      for (let i = 0; i < row.references.length; i++) {
        const reference = row.references[i];
        const targetContent = await findTargetContent(
          reference.text,
          pdfDocumentId
        );

        await prisma.contentReference.create({
          data: {
            sourceContentId: sourceContentId,
            targetContentId: targetContent?.id || null,
            referenceText: reference.text,
            referenceType: "definition",
            targetReferenceCode: targetContent?.reference_code || null,
            pageNumber: reference.page,
            // Removed: fontFamily, bbox from references too
            hyperlinkTarget: targetContent?.hyperlink_target || null,
            hyperlinkText: reference.link_text || null,
            referencePosition: i,
          },
        });

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

    console.log(`✅ Successfully processed ${referenceCount} references`);
    console.log(`❌ Unresolved references: ${unresolvedReferences}`);
  } catch (error) {
    console.error("Error during import:", error);
    throw error;
  }
};

// Main function to run the complete import process
const runCompleteImport = async () => {
  try {
    // Initialize database cache first
    await initializeDbCache();

    const jsonFilePath = path.join(__dirname, "merged_spans.json");

    console.log("📄 Creating PDF document entry...");
    const pdfDocumentId = await createPdfDocument({
      file_name: "national-building-code-2023-alberta.pdf",
      original_file_name: "National Building Code – 2023 Alberta Edition.pdf",
      file_size: fs.statSync(jsonFilePath).size,
      jurisdiction_name: "Alberta",
      document_type_name: "Codes",
      language_code: "en",
      title: "National Building Code – 2023 Alberta Edition",
      year: 2023,
      version: "2023",
      effective_date: "2023-01-01",
      file_path: "/documents/national-building-code-2023-alberta.pdf",
    });

    console.log(`✅ Created PDF document with ID: ${pdfDocumentId}`);
    await importJsonData(jsonFilePath, pdfDocumentId);
    console.log("✅ Data import completed successfully");
  } catch (error) {
    console.error("❌ Import process failed:", error);
    throw error;
  }
};

// Run the complete import process
runCompleteImport()
  .then(() => {
    console.log("🎉 Complete import process finished successfully");
    prisma.$disconnect();
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Complete import process failed:", error);
    prisma.$disconnect();
    process.exit(1);
  });
