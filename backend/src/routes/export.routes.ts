// ============================================================
// Export Routes
// ============================================================

import { Router } from "express";
import { exportCSV, exportExcel, exportPDF } from "../controllers/export.controller";

const router = Router();

// GET /export/csv/:traineeId
router.get("/csv/:traineeId", exportCSV);

// GET /export/excel/:traineeId
router.get("/excel/:traineeId", exportExcel);

// GET /export/pdf/:traineeId
router.get("/pdf/:traineeId", exportPDF);

export default router;
