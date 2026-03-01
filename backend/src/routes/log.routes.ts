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
} from "../controllers/log.controller";
import { validateLogEntry, validateLogUpdate, sanitizeBody } from "../middleware/validate";

const router = Router();

// POST /logs               — create a new log entry (validated)
router.post("/", sanitizeBody, validateLogEntry, createLog);

// GET  /logs/offset/:traineeId — get available offset for a trainee
router.get("/offset/:traineeId", getOffset);

// GET  /logs/:traineeId    — get all logs for a trainee
router.get("/:traineeId", getLogsByTrainee);

// PUT  /logs/:id           — update a log entry (validated)
router.put("/:id", sanitizeBody, validateLogUpdate, updateLog);

// DELETE /logs/entry/:id   — delete a log entry
router.delete("/entry/:id", deleteLog);

export default router;
