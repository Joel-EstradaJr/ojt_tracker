// ============================================================
// Trainee Routes
// ============================================================

import { Router } from "express";
import {
  createTrainee,
  updateTrainee,
  getAllTrainees,
  getTraineeById,
  verifyTraineePassword,
  forgotPassword,
  verifyResetCode,
  resetPassword,
  deleteTrainee,
  resendTempPassword,
} from "../controllers/trainee.controller";
import { validateTrainee, validateTraineeUpdate, sanitizeBody } from "../middleware/validate";
import { requireAuth, requireAdmin, attachAuthIfPresent } from "../middleware/auth";

const router = Router();

// POST /trainees          — create a new trainee
router.post("/", attachAuthIfPresent, sanitizeBody, validateTrainee, createTrainee);

// PUT  /trainees/:id      — update trainee info (auth required)
router.put("/:id", requireAuth, sanitizeBody, validateTraineeUpdate, updateTrainee);

// GET  /trainees          — list all trainees (card view)
router.get("/", requireAuth, requireAdmin, getAllTrainees);

// GET  /trainees/:id      — get single trainee info (auth required)
router.get("/:id", requireAuth, getTraineeById);

// POST /trainees/:id/verify — verify password to unlock logs
router.post("/:id/verify", verifyTraineePassword);

// POST /trainees/:id/forgot-password — send a reset code to email
router.post("/:id/forgot-password", forgotPassword);

// POST /trainees/:id/verify-reset-code — verify the emailed code
router.post("/:id/verify-reset-code", verifyResetCode);

// PUT  /trainees/:id/reset-password — reset password (requires verified token)
router.put("/:id/reset-password", resetPassword);

// DELETE /trainees/:id    — delete trainee + cascading logs & supervisors
router.delete("/:id", requireAuth, requireAdmin, deleteTrainee);

// POST /trainees/:id/resend-temp-password — resend temp password (admin only)
router.post("/:id/resend-temp-password", requireAuth, requireAdmin, resendTempPassword);

export default router;
