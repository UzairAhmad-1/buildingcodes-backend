// src/server.ts
import express from "express";
import cors from "cors";
import morgan from "morgan";
import buildingCodeRoutes from "./src/routes/buildingCode";
import jurisdictionRoutes from "./src/routes/jurisdictions";
import documentTypeRoutes from "./src/routes/documentTypes";
import languageRoutes from "./src/routes/languages";
import pdfDocumentRoutes from "./src/routes/pdfDocuments";
import adminAuthRoutes from "./src/routes/adminAuth";
import searchRoutes from "./src/routes/search";
import path from "path";
import fs from "fs";
import prisma from "./src/db";

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

// Debug: Check uploads directory
const uploadsDir = path.join(process.cwd(), "uploads");
if (fs.existsSync(uploadsDir)) {
  const files = fs.readdirSync(uploadsDir);
  console.log("📄 Files in uploads directory:", files);
} else {
  console.log("❌ Uploads directory does not exist at:", uploadsDir);
}

// Serve uploaded files
app.use("/uploads", express.static(uploadsDir));

// Debug route
app.get("/debug-uploads", (req, res) => {
  const files = fs.readdirSync(uploadsDir);
  res.json({
    uploadsDirectory: uploadsDir,
    files: files,
    staticServing: `Serving from: ${uploadsDir}`,
  });
});

// Routes
app.use("/api/building-code", buildingCodeRoutes);
app.use("/api/jurisdictions", jurisdictionRoutes);
app.use("/api/document-types", documentTypeRoutes);
app.use("/api/languages", languageRoutes);
app.use("/api/pdf-documents", pdfDocumentRoutes);
app.use("/api/admin/auth", adminAuthRoutes);
app.use("/api/search", searchRoutes);

// Health check with DB connection test
app.get("/api/health", async (req, res) => {
  try {
    // Test database connection
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: "OK",
      message: "Building Code API is running",
      database: "Connected",
    });
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    res.status(500).json({
      status: "ERROR",
      message: "Database connection failed",
      error: errorMessage,
    });
  }
});

// Initialize database connection
async function initializeDatabase() {
  try {
    await prisma.$connect();
    console.log("✅ Connected to PostgreSQL database via Prisma");

    // Test the connection
    await prisma.$queryRaw`SELECT 1`;
    console.log("✅ Database connection test successful");
  } catch (error) {
    console.error("❌ Failed to connect to database:", error);
    process.exit(1);
  }
}

// Start server
async function startServer() {
  await initializeDatabase();

  app.listen(PORT, () => {
    console.log(`✅ Server is running on port ${PORT}`);
  });
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("🛑 Shutting down gracefully...");
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("🛑 Shutting down gracefully...");
  await prisma.$disconnect();
  process.exit(0);
});

startServer().catch((error: unknown) => {
  const errorMessage =
    error instanceof Error ? error.message : "Unknown error occurred";
  console.error(errorMessage);
});
