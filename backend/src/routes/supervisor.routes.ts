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
import { validateSupervisor } from "../middleware/validate";

const router = Router();

// POST /supervisors/:traineeId  — add supervisor to trainee
router.post("/:traineeId", validateSupervisor, createSupervisor);

// GET  /supervisors/:traineeId  — list supervisors for trainee
router.get("/:traineeId", getSupervisorsByTrainee);

// PUT  /supervisors/entry/:id   — update a supervisor
router.put("/entry/:id", validateSupervisor, updateSupervisor);

// DELETE /supervisors/entry/:id — remove a supervisor
router.delete("/entry/:id", deleteSupervisor);

export default router;
