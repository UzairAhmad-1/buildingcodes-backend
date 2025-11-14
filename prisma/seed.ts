// prisma/seed.ts
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting database seeding...");

  // Create jurisdictions
  const jurisdictions = await Promise.all([
    prisma.jurisdiction.upsert({
      where: { name: "All" },
      update: {},
      create: {
        name: "All",
        code: "ALL",
      },
    }),
    prisma.jurisdiction.upsert({
      where: { name: "Alberta" },
      update: {},
      create: {
        name: "Alberta",
        code: "AB",
      },
    }),
    prisma.jurisdiction.upsert({
      where: { name: "Ontario" },
      update: {},
      create: {
        name: "Ontario",
        code: "ON",
      },
    }),
    prisma.jurisdiction.upsert({
      where: { name: "British Columbia" },
      update: {},
      create: {
        name: "British Columbia",
        code: "BC",
      },
    }),
    prisma.jurisdiction.upsert({
      where: { name: "New Brunswick" },
      update: {},
      create: {
        name: "New Brunswick",
        code: "NB",
      },
    }),
    prisma.jurisdiction.upsert({
      where: { name: "Nova Scotia" },
      update: {},
      create: {
        name: "Nova Scotia",
        code: "NS",
      },
    }),
    prisma.jurisdiction.upsert({
      where: { name: "Prince Edward Island" },
      update: {},
      create: {
        name: "Prince Edward Island",
        code: "PE",
      },
    }),
    prisma.jurisdiction.upsert({
      where: { name: "Northwest Territories" },
      update: {},
      create: {
        name: "Northwest Territories",
        code: "NT",
      },
    }),
    prisma.jurisdiction.upsert({
      where: { name: "Yukon" },
      update: {},
      create: {
        name: "Yukon",
        code: "YT",
      },
    }),
    prisma.jurisdiction.upsert({
      where: { name: "National" },
      update: {},
      create: {
        name: "National",
        code: "CA", // Changed from NT to CA for Canada
      },
    }),
  ]);

  console.log(`✅ Created ${jurisdictions.length} jurisdictions`);

  // Create document types
  const documentTypes = await Promise.all([
    prisma.documentType.upsert({
      where: { name: "Codes" },
      update: {},
      create: {
        name: "Codes",
        description: "Building and construction codes",
      },
    }),
    prisma.documentType.upsert({
      where: { name: "Acts" },
      update: {},
      create: {
        name: "Acts",
        description: "Legislative acts and regulations",
      },
    }),
    prisma.documentType.upsert({
      where: { name: "Standards" },
      update: {},
      create: {
        name: "Standards",
        description: "Industry standards and specifications",
      },
    }),
    prisma.documentType.upsert({
      where: { name: "Intents" },
      update: {},
      create: {
        name: "Intents",
        description: "Statements of intent and objectives",
      },
    }),
    prisma.documentType.upsert({
      where: { name: "Guides" },
      update: {},
      create: {
        name: "Guides",
        description: "Guidance documents and manuals",
      },
    }),
  ]);

  console.log(`✅ Created ${documentTypes.length} document types`);

  // Create languages
  const languages = await Promise.all([
    prisma.language.upsert({
      where: { code: "en" },
      update: {},
      create: {
        code: "en",
        name: "English",
      },
    }),
    prisma.language.upsert({
      where: { code: "fr" },
      update: {},
      create: {
        code: "fr",
        name: "French",
      },
    }),
  ]);

  console.log(`✅ Created ${languages.length} languages`);

  // Create default admin user
  const hashedPassword = await bcrypt.hash("admin123", 12);
  const admin = await prisma.admin.upsert({
    where: { email: "admin@buildingcode.com" },
    update: {},
    create: {
      email: "admin@buildingcode.com",
      passwordHash: hashedPassword,
      name: "System Administrator",
    },
  });

  console.log("✅ Created default admin user");

  console.log("🌱 Database seeding completed!");
}

main()
  .catch((e) => {
    console.error("❌ Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
