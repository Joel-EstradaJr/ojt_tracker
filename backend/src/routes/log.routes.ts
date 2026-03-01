// ============================================================
// Log Entry Routes
// ============================================================

import { Router } from "express";
import {
  createLog,
  getLogsByTrainee,
  updateLog,
  deleteLog,
} from "../controllers/log.controller";
import { validateLogEntry } from "../middleware/validate";

const router = Router();

// POST /logs               — create a new log entry (validated)
router.post("/", validateLogEntry, createLog);

// GET  /logs/:traineeId    — get all logs for a trainee
router.get("/:traineeId", getLogsByTrainee);

// PUT  /logs/:id           — update a log entry
router.put("/:id", updateLog);

// DELETE /logs/entry/:id   — delete a log entry
router.delete("/entry/:id", deleteLog);

export default router;
