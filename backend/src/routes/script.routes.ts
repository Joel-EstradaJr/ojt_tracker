import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { sanitizeBody, validateScriptCreate, validateScriptUpdate } from "../middleware/validate";
import { createScript, getScriptsByTrainee, updateScript } from "../controllers/script.controller";

const router = Router();

router.get("/:traineeId", requireAuth, getScriptsByTrainee);
router.post("/:traineeId", requireAuth, sanitizeBody, validateScriptCreate, createScript);
router.put("/entry/:scriptId", requireAuth, sanitizeBody, validateScriptUpdate, updateScript);

export default router;
