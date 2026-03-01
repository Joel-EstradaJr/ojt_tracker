// ============================================================
// Import Routes
// Uses multer middleware to handle multipart CSV uploads.
// ============================================================

import { Router } from "express";
import { upload } from "../middleware/upload";
import { importCSV } from "../controllers/import.controller";
import { importAllCSV } from "../controllers/bulk.controller";
import { requireAuth } from "../middleware/auth";

const router = Router();

// POST /import/all — restore full database from backup CSV
router.post("/all", upload.single("file"), importAllCSV);

// POST /import/csv/:traineeId  — upload a CSV of log entries
router.post("/csv/:traineeId", requireAuth, upload.single("file"), importCSV);

export default router;
