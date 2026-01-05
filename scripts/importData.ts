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
  list_title?: string;
  image_data?: string; // Add this
  format?: string; // Add this
  width?: number; // Add this
  height?: number; // Add this
  caption?: string; // Add this
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
    NoteSection: ContentType.note_section,
    NoteItem: ContentType.note_item,
    NoteContent: ContentType.note_content,
    ListItem: ContentType.list_item,
    Image: ContentType.image,
  };

  // Skip Table and Symbol labels, but NOT Image
  if (label === "Table" || label === "Symbol" || label === "Figure") {
    return null;
  }

  return typeMap[label] || ContentType.section;
};

const extractReferenceCode = (
  title: string,
  text: string,
  label: string,
  listTitle?: string
): string => {
  // For Image, use title as reference code
  if (label === "Image" && title) {
    return title.trim();
  }

  // For ListItem, use list_title if available
  if (label === "ListItem" && listTitle) {
    return listTitle.trim();
  }
  // Clean the title/text first
  const cleanTitle = title ? title.trim() : "";
  const cleanText = text ? text.trim() : "";

  // For NoteSection and NoteItem, always use title as reference code
  if ((label === "NoteSection" || label === "NoteItem") && cleanTitle) {
    return cleanTitle;
  }

  // For DefTerm, use term if available (this comes from the title parameter)
  if (label === "DefTerm" && cleanTitle) {
    return cleanTitle;
  }

  // For high-level structural elements (Division, Part, Section), use title as reference code
  const structuralElements = [
    "Division",
    "Part",
    "Section",
    "Subsection",
    "Article",
  ];
  if (structuralElements.includes(label) && cleanTitle) {
    return cleanTitle;
  }

  // For NoteContent, use empty reference code
  if (label === "NoteContent") {
    return "";
  }

  // For Sentence, check if we should use title or text
  if (label === "Sentence") {
    // If title exists and text is empty, use title as content, not reference code
    if (cleanTitle && (!cleanText || cleanText === "")) {
      return "";
    }
    // If both title and text exist, use title pattern as reference code if it matches
    if (cleanTitle && /^[\d\.\)]+$/.test(cleanTitle.replace(/\s/g, ""))) {
      return cleanTitle;
    }
  }

  // Use title as reference code if it matches pattern - FIXED: added \( to pattern
  if (
    cleanTitle &&
    /^[\d\.a-z\(\)\-\:]+$/.test(cleanTitle.replace(/\s/g, ""))
  ) {
    return cleanTitle;
  }

  // Extract from text as fallback only for certain types
  const extractFromTextTypes = ["Clause", "Subclause", "Sentence"];
  if (extractFromTextTypes.includes(label)) {
    const patterns = [
      /^([\d\.\-]+)[\s\)\.]/,
      /^([a-z]\))[\s]/,
      /^(i+\))[\s]/,
      /^([A-Z]\))[\s]/,
    ];

    for (const pattern of patterns) {
      const match = cleanText.match(pattern);
      if (match) {
        // Keep the parentheses if they exist
        return match[1].trim();
      }
    }
  }

  return "";
};

const extractContentText = (
  text: string,
  title: string,
  referenceCode: string,
  label: string,
  listTitle?: string,
  caption?: string
): string => {
  // For Image, use caption as content text if available
  if (label === "Image") {
    if (caption) {
      return caption.trim();
    }
    // Fallback to title if no caption
    if (title) {
      return title.trim();
    }
    // Final fallback
    return text ? text.trim() : "";
  }

  // For NoteContent, handle undefined text
  if (label === "NoteContent") {
    return text ? text.trim() : "";
  }

  if (label === "ListItem") {
    return text ? text.trim() : "";
  }

  // For NoteSection and NoteItem, use text as content text
  if (label === "NoteSection" || label === "NoteItem") {
    return text ? text.trim() : "";
  }

  // For DefTerm, use the text as content text
  if (label === "DefTerm") {
    return text ? text.trim() : "";
  }

  // For Sentence where title exists but text is empty, use title as content
  if (label === "Sentence" && title && (!text || text.trim() === "")) {
    return title.trim();
  }

  // For SeeAlso, use the text as-is
  if (label === "SeeAlso") {
    return text ? text.trim() : "";
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
    return text ? text.trim() : "";
  }

  // Remove reference code from text if present
  if (referenceCode && text && text.startsWith(referenceCode)) {
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

  // Handle case where text might be undefined or null
  return text ? text.trim() : "";
};
// Check if content is a definition
const isDefinitionContent = (text: string, label: string): boolean => {
  // Only DefTerm is a definition
  return label === "DefTerm";
};

const extractDefinitionTerm = (
  text: string,
  label: string,
  jsonTitle?: string,
  jsonTerm?: string
): string | null => {
  // Only extract term for DefTerm labels
  if (label === "DefTerm") {
    // First priority: use the explicit term field from JSON
    if (jsonTerm) {
      // Clean the term - remove quotes, parentheses, extra spaces
      return jsonTerm
        .replace(/^["'(]+|["'),;:!?.]+$/g, "") // Remove surrounding quotes/parentheses
        .trim();
    }
    // Second priority: use the title field
    if (jsonTitle) {
      return jsonTitle.replace(/^["'(]+|["'),;:!?.]+$/g, "").trim();
    }
    // Fallback: extract term from DefTerm text pattern
    // Try multiple patterns
    const patterns = [
      /^"([^"]+)"\s+means/, // "Term" means
      /^"([^"]+)"\s+is defined as/, // "Term" is defined as
      /^"([^"]+)"\s+includes/, // "Term" includes
      /^([^,]+?)\s+means/, // Term means (no quotes)
      /^([^,]+?)\s+is defined as/, // Term is defined as
      /^([^,]+?)\s+includes/, // Term includes
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1].replace(/^["'(]+|["'),;:!?.]+$/g, "").trim();
      }
    }

    // Final fallback
    const meansIndex = text.toLowerCase().indexOf(" means");
    if (meansIndex > 0) {
      return text
        .substring(0, meansIndex)
        .replace(/^["'(]+|["'),;:!?.]+$/g, "")
        .trim();
    }

    return null;
  }

  return null; // Only DefTerm has definition terms
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

// Update the findTargetContent function to better handle all cases
const findTargetContent = async (
  referenceText: string,
  pdfDocumentId: string
): Promise<{
  id: number;
  reference_code: string | null;
  hyperlink_target: string;
} | null> => {
  try {
    // Clean and normalize the reference text
    let cleanReferenceText = referenceText
      .trim()
      .replace(/^[\s"']+|[\s"']+$/g, "")
      .toLowerCase();

    console.log(`🔍 Searching for target content: "${cleanReferenceText}"`);

    // Handle possessive forms like "building's" -> "building"
    cleanReferenceText = cleanReferenceText.replace(/'s$/, "");

    // Generate all possible variations of the term
    const termVariations = new Set<string>();

    // Original cleaned term
    termVariations.add(cleanReferenceText);

    // Singular version (remove trailing 's')
    if (cleanReferenceText.endsWith("s")) {
      const singular = cleanReferenceText.slice(0, -1);
      termVariations.add(singular);

      // Also try removing 'ies' and adding 'y' (e.g., "occupancies" -> "occupancy")
      if (cleanReferenceText.endsWith("ies")) {
        const yForm = cleanReferenceText.slice(0, -3) + "y";
        termVariations.add(yForm);
      }
    }

    // Plural version (add 's')
    const plural = cleanReferenceText + "s";
    termVariations.add(plural);

    // Also try with 'es' for words ending in certain letters
    if (cleanReferenceText.match(/[sxz]$|ch$|sh$/)) {
      const pluralEs = cleanReferenceText + "es";
      termVariations.add(pluralEs);
    }

    // Convert to array for querying
    const termVariationsArray = Array.from(termVariations);
    console.log(`  Term variations: ${termVariationsArray.join(", ")}`);

    // STRATEGY 1: Try exact matches with all term variations
    const exactDefinition = await prisma.buildingCodeContent.findFirst({
      where: {
        pdfDocumentId: pdfDocumentId,
        isDefinition: true,
        definitionTerm: {
          in: termVariationsArray,
          mode: "insensitive",
        },
      },
      orderBy: [{ sequenceOrder: "asc" }],
    });

    if (exactDefinition) {
      console.log(
        `  ✓ Found exact definition: "${exactDefinition.definitionTerm}" (ID: ${exactDefinition.id})`
      );
      return {
        id: exactDefinition.id,
        reference_code: exactDefinition.referenceCode,
        hyperlink_target: `#definition-${exactDefinition.id}`,
      };
    }

    // STRATEGY 2: Try contains matches for each variation
    // Build OR conditions for each variation
    const containsConditions = termVariationsArray.map((term) => ({
      pdfDocumentId: pdfDocumentId,
      isDefinition: true,
      contentText: {
        contains: ` ${term} means`,
        mode: "insensitive" as const, // Use const assertion or Prisma.QueryMode
      },
    }));

    // Also check for quoted terms
    const quotedConditions = termVariationsArray.map((term) => ({
      pdfDocumentId: pdfDocumentId,
      isDefinition: true,
      contentText: {
        contains: `"${term}" means`,
        mode: "insensitive" as const,
      },
    }));

    const allConditions = [...containsConditions, ...quotedConditions];

    const containsDefinition = await prisma.buildingCodeContent.findFirst({
      where: {
        OR: allConditions,
      },
      orderBy: [{ sequenceOrder: "asc" }],
    });

    if (containsDefinition) {
      console.log(
        `  ✓ Found definition by pattern: "${containsDefinition.definitionTerm}" (ID: ${containsDefinition.id})`
      );
      return {
        id: containsDefinition.id,
        reference_code: containsDefinition.referenceCode,
        hyperlink_target: `#definition-${containsDefinition.id}`,
      };
    }

    // STRATEGY 3: Try definitionTerm contains (partial matches)
    const partialMatches = await prisma.buildingCodeContent.findMany({
      where: {
        pdfDocumentId: pdfDocumentId,
        isDefinition: true,
        OR: termVariationsArray.map((term) => ({
          definitionTerm: {
            contains: term,
            mode: "insensitive" as const,
          },
        })),
      },
      orderBy: [{ definitionTerm: "asc" }, { sequenceOrder: "asc" }],
      take: 3,
    });

    // Filter to find the best partial match
    if (partialMatches.length > 0) {
      // Sort by how closely the definition term matches our variations
      const sortedMatches = partialMatches.sort((a, b) => {
        const aTerm = a.definitionTerm?.toLowerCase() || "";
        const bTerm = b.definitionTerm?.toLowerCase() || "";

        // Prefer exact or closer matches
        const aScore = termVariationsArray.some(
          (v) => aTerm === v || aTerm.startsWith(v)
        )
          ? 1
          : 0;
        const bScore = termVariationsArray.some(
          (v) => bTerm === v || bTerm.startsWith(v)
        )
          ? 1
          : 0;

        return bScore - aScore;
      });

      const bestMatch = sortedMatches[0];
      console.log(
        `  ✓ Found partial match: "${bestMatch.definitionTerm}" (ID: ${bestMatch.id})`
      );
      return {
        id: bestMatch.id,
        reference_code: bestMatch.referenceCode,
        hyperlink_target: `#definition-${bestMatch.id}`,
      };
    }

    // STRATEGY 4: Look for any definition that mentions the term
    const broadDefinitionSearch = await prisma.buildingCodeContent.findFirst({
      where: {
        pdfDocumentId: pdfDocumentId,
        isDefinition: true,
        OR: [
          {
            contentText: {
              contains: cleanReferenceText,
              mode: "insensitive" as const,
            },
          },
          // Add conditions for each term variation
          ...termVariationsArray.map((term) => ({
            contentText: {
              contains: term,
              mode: "insensitive" as const,
            },
          })),
        ],
      },
      orderBy: [{ sequenceOrder: "asc" }],
    });

    if (broadDefinitionSearch) {
      console.log(
        `  ✓ Found definition by broad search: "${broadDefinitionSearch.definitionTerm}" (ID: ${broadDefinitionSearch.id})`
      );
      return {
        id: broadDefinitionSearch.id,
        reference_code: broadDefinitionSearch.referenceCode,
        hyperlink_target: `#definition-${broadDefinitionSearch.id}`,
      };
    }

    // STRATEGY 5: Check for "means" pattern
    const meansPattern = await prisma.buildingCodeContent.findFirst({
      where: {
        pdfDocumentId: pdfDocumentId,
        contentText: {
          startsWith: `${referenceText.trim()} means`,
          mode: "insensitive" as const,
        },
      },
      orderBy: [{ sequenceOrder: "asc" }],
    });

    if (meansPattern) {
      console.log(
        `  ⚠️ Found means pattern (may not be marked as definition): (ID: ${meansPattern.id})`
      );
      return {
        id: meansPattern.id,
        reference_code: meansPattern.referenceCode,
        hyperlink_target: meansPattern.isDefinition
          ? `#definition-${meansPattern.id}`
          : `#content-${meansPattern.id}`,
      };
    }

    // STRATEGY 6: Special handling for compound terms
    if (cleanReferenceText.includes(" ")) {
      const words = cleanReferenceText.split(" ");
      const lastWord = words[words.length - 1];
      console.log(`  Trying last word: "${lastWord}"`);

      const lastWordDefinition = await prisma.buildingCodeContent.findFirst({
        where: {
          pdfDocumentId: pdfDocumentId,
          isDefinition: true,
          definitionTerm: {
            equals: lastWord,
            mode: "insensitive" as const,
          },
        },
        orderBy: [{ sequenceOrder: "asc" }],
      });

      if (lastWordDefinition) {
        console.log(
          `  ✓ Found definition by last word: "${lastWordDefinition.definitionTerm}" (ID: ${lastWordDefinition.id})`
        );
        return {
          id: lastWordDefinition.id,
          reference_code: lastWordDefinition.referenceCode,
          hyperlink_target: `#definition-${lastWordDefinition.id}`,
        };
      }
    }

    console.log(`  ✗ No definition found for: "${cleanReferenceText}"`);
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
      ContentType.note_section,
      ContentType.subsection,
      ContentType.note_item,
      ContentType.article,
      ContentType.sentence,
      ContentType.definition, // List items can also be in definitions
      ContentType.list_item, // Place list_item here - it can be child of many types
      ContentType.image, // Add Image to hierarchy
      ContentType.clause,
      ContentType.subclause,
      ContentType.see_also,
      ContentType.note_content,
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

      // Skip Table, Symbol, and Figure labels (Image is now handled)
      if (contentType === null) {
        // console.log(`⏭️  Skipping ${row.label}: ${row.text ? row.text.substring(0, 50) : ''}...`);
        continue;
      }

      const referenceCode = extractReferenceCode(
        row.title || "",
        row.text || "",
        row.label,
        row.list_title
      );

      const contentText = extractContentText(
        row.text || "",
        row.title || "",
        referenceCode,
        row.label,
        row.list_title,
        row.caption
      );
      const pageNumber = row.page;

      // Check if this is definition content
      const isDefinition = isDefinitionContent(contentText, row.label);
      const definitionTerm = isDefinition
        ? extractDefinitionTerm(contentText, row.label, row.title, row.term) // Add row.term here
        : null;

      console.log(
        `Processing: ${row.label} - ${contentText.substring(0, 50)}...`
      );
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
      } else if (contentType === ContentType.list_item) {
        // ListItem - can be child of sentence, section, subsection, clause, or definition
        // Use the same hierarchy-based parent finding
        for (let i = hierarchyStack.length - 1; i >= 0; i--) {
          const stackItem = hierarchyStack[i];
          const currentIndex = hierarchy.indexOf(contentType);
          const stackIndex = hierarchy.indexOf(stackItem.type);
          if (stackIndex < currentIndex) {
            parentId = stackItem.id;

            // Log what type of parent we found
            const parentType = ContentType[stackItem.type];
            console.log(
              `  → Attaching ListItem to ${parentType} ID: ${parentId}`
            );
            break;
          }
        }
        // List items don't create new definitions
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
      } else if (contentType === ContentType.image) {
        // Image - attach to the most recent appropriate parent (similar to ListItem)
        for (let i = hierarchyStack.length - 1; i >= 0; i--) {
          const stackItem = hierarchyStack[i];
          const currentIndex = hierarchy.indexOf(contentType);
          const stackIndex = hierarchy.indexOf(stackItem.type);
          if (stackIndex < currentIndex) {
            parentId = stackItem.id;

            // Log what type of parent we found
            const parentType = ContentType[stackItem.type];
            console.log(`  → Attaching Image to ${parentType} ID: ${parentId}`);
            break;
          }
        }
        // Images don't create new definitions
        currentDefinitionId = null;
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
      const contentData: any = {
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
      };

      // Add image data if this is an Image type
      if (contentType === ContentType.image) {
        contentData.imageData = row.image_data || null;
        contentData.imageFormat = row.format || null;
        contentData.imageWidth = row.width || null;
        contentData.imageHeight = row.height || null;
      }

      const newContent = await prisma.buildingCodeContent.create({
        data: contentData,
      });

      const newId: number = newContent.id;

      // Store definition terms for reference resolution
      if (isDefinition && definitionTerm) {
        // Clean the definition term
        const cleanDefinitionTerm = definitionTerm
          .replace(/^["'(]+|["'),;:!?.]+$/g, "")
          .toLowerCase()
          .trim();

        if (cleanDefinitionTerm) {
          // Store the term as-is
          definitionTerms.set(cleanDefinitionTerm, newId);

          // Store singular version
          if (cleanDefinitionTerm.endsWith("s")) {
            const singular = cleanDefinitionTerm.slice(0, -1);
            if (singular.length > 1) {
              definitionTerms.set(singular, newId);
            }
          }

          // Store plural version
          const plural = cleanDefinitionTerm + "s";
          definitionTerms.set(plural, newId);

          // Handle "ies" -> "y" transformations
          if (cleanDefinitionTerm.endsWith("ies")) {
            const yForm = cleanDefinitionTerm.slice(0, -3) + "y";
            definitionTerms.set(yForm, newId);
          }

          // Handle "y" -> "ies" transformations
          if (cleanDefinitionTerm.endsWith("y")) {
            const iesForm = cleanDefinitionTerm.slice(0, -1) + "ies";
            definitionTerms.set(iesForm, newId);
          }

          // Store without possessive
          const withoutPossessive = cleanDefinitionTerm.replace(/'s$/, "");
          if (withoutPossessive !== cleanDefinitionTerm) {
            definitionTerms.set(withoutPossessive, newId);
          }

          console.log(
            `  ✓ Definition term: "${cleanDefinitionTerm}" -> ID: ${newId}`
          );
        }

        // Set as current definition for subsequent clauses
        currentDefinitionId = newId;
        console.log(`  → Set as current definition ID: ${currentDefinitionId}`);
      }

      // Only set as current definition for actual DefTerm content
      if (contentType === ContentType.definition && row.label === "DefTerm") {
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
        contentType !== ContentType.note_content &&
        contentType !== ContentType.image // Don't push Image to hierarchy stack
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
      } tables/figures/symbols)`
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
        // This might be a table or image that was skipped, so skip its references too
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

            confidenceScore: 1.0, // Add default confidence score
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
