// ============================================================
// Export Routes
// ============================================================

import { Router } from "express";
import { exportCSV, exportExcel, exportPDF } from "../controllers/export.controller";
import { exportAllCSV } from "../controllers/bulk.controller";
import { requireAuth } from "../middleware/auth";

const router = Router();

// GET /export/all — full database backup CSV
router.get("/all", exportAllCSV);

// GET /export/csv/:traineeId
router.get("/csv/:traineeId", requireAuth, exportCSV);

// GET /export/excel/:traineeId
router.get("/excel/:traineeId", requireAuth, exportExcel);

// GET /export/pdf/:traineeId
router.get("/pdf/:traineeId", requireAuth, exportPDF);

export default router;
