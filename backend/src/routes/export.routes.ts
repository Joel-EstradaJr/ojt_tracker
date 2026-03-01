// ============================================================
// Export Routes
// ============================================================

import { Router } from "express";
import { exportCSV, exportExcel, exportPDF } from "../controllers/export.controller";
import { exportAllCSV } from "../controllers/bulk.controller";

const router = Router();

// GET /export/all — full database backup CSV
router.get("/all", exportAllCSV);

// GET /export/csv/:traineeId
router.get("/csv/:traineeId", exportCSV);

// GET /export/excel/:traineeId
router.get("/excel/:traineeId", exportExcel);

// GET /export/pdf/:traineeId
router.get("/pdf/:traineeId", exportPDF);

export default router;
