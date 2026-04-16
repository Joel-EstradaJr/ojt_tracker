// ============================================================
// Log Entry Routes
// ============================================================

import { Router } from "express";
import {
  createLog,
  getLogsByTrainee,
  updateLog,
  deleteLog,
  getOffset,
  patchLogAction,
} from "../controllers/log.controller";
import { validateLogEntry, validateLogUpdate, sanitizeBody } from "../middleware/validate";
import { requireAuth } from "../middleware/auth";

const router = Router();

// POST /logs               — create a new log entry (validated)
router.post("/", requireAuth, sanitizeBody, validateLogEntry, createLog);

// GET  /logs/offset/:traineeId — get available offset for a trainee
router.get("/offset/:traineeId", requireAuth, getOffset);

// GET  /logs/:traineeId    — get all logs for a trainee
router.get("/:traineeId", requireAuth, getLogsByTrainee);

// PUT  /logs/:entryId      — update a log entry (validated)
router.put("/:entryId", requireAuth, sanitizeBody, validateLogUpdate, updateLog);

// PATCH /logs/:id/action   — sequential button action (trainee flow)
router.patch("/:id/action", requireAuth, patchLogAction);

// DELETE /logs/entry/:entryId — delete a log entry
router.delete("/entry/:entryId", requireAuth, deleteLog);

export default router;
