// src/server.ts
import express from "express";
import cors from "cors";
import morgan from "morgan";
import buildingCodeRoutes from "./src/routes/buildingCode";
import jurisdictionRoutes from "./src/routes/jurisdictions";
import documentTypeRoutes from "./src/routes/documentTypes";
import languageRoutes from "./src/routes/languages";
import pdfDocumentRoutes from "./src/routes/pdfDocuments";
const app = express();
const PORT = process.env.PORT || 3001;
``
// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan("dev")); // <-- logs HTTP requests in console

// Routes
app.use("/api/building-code", buildingCodeRoutes);
app.use("/api/jurisdictions", jurisdictionRoutes);
app.use("/api/document-types", documentTypeRoutes);
app.use("/api/languages", languageRoutes);
app.use("/api/pdf-documents", pdfDocumentRoutes);
// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "OK", message: "Building Code API is running" });
});

app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});
