// ============================================================
// Supervisor Routes
// ============================================================

import { Router } from "express";
import {
  createSupervisor,
  getSupervisorsByTrainee,
  updateSupervisor,
  deleteSupervisor,
} from "../controllers/supervisor.controller";
import { validateSupervisor, sanitizeBody } from "../middleware/validate";
import { requireAuth } from "../middleware/auth";

const router = Router();

// POST /supervisors/:traineeId  — add supervisor to trainee
router.post("/:traineeId", requireAuth, sanitizeBody, validateSupervisor, createSupervisor);

// GET  /supervisors/:traineeId  — list supervisors for trainee
router.get("/:traineeId", requireAuth, getSupervisorsByTrainee);

// PUT  /supervisors/entry/:id   — update a supervisor
router.put("/entry/:id", requireAuth, sanitizeBody, validateSupervisor, updateSupervisor);

// DELETE /supervisors/entry/:id — remove a supervisor
router.delete("/entry/:id", requireAuth, deleteSupervisor);

export default router;
