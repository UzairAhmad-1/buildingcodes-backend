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
// src/server.ts (or wherever you configure routes)
import searchRoutes from "./src/routes/search";

// Add this with your other routes

import path from "path";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 8080; // Make sure this matches your actual port

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

// Debug: Check uploads directory
const uploadsDir = path.join(process.cwd(), "uploads");
// Check if uploads directory exists
if (fs.existsSync(uploadsDir)) {
  const files = fs.readdirSync(uploadsDir);
  console.log("📄 Files in uploads directory:", files);
} else {
  console.log("❌ Uploads directory does not exist at:", uploadsDir);
}

// Serve uploaded files from the correct directory
app.use("/uploads", express.static(uploadsDir));

// Debug route to check static file serving
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
// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "OK", message: "Building Code API is running" });
});

app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});
