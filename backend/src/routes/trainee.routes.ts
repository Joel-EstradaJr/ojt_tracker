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
  resetPassword,
  deleteTrainee,
} from "../controllers/trainee.controller";
import { validateTrainee, validateTraineeUpdate, sanitizeBody } from "../middleware/validate";

const router = Router();

// POST /trainees          — create a new trainee
router.post("/", sanitizeBody, validateTrainee, createTrainee);

// PUT  /trainees/:id      — update trainee info
router.put("/:id", sanitizeBody, validateTraineeUpdate, updateTrainee);

// GET  /trainees          — list all trainees (card view)
router.get("/", getAllTrainees);

// GET  /trainees/:id      — get single trainee info
router.get("/:id", getTraineeById);

// POST /trainees/:id/verify — verify password to unlock logs
router.post("/:id/verify", verifyTraineePassword);

// PUT  /trainees/:id/reset-password — reset a forgotten password
router.put("/:id/reset-password", resetPassword);

// DELETE /trainees/:id    — delete trainee + cascading logs & supervisors
router.delete("/:id", deleteTrainee);

export default router;
