// ============================================================
// Settings Routes — admin controls for overtime toggles
// ============================================================

import { Router } from "express";
import { getSettings, updateSettings } from "../controllers/settings.controller";
import { requireAuth, requireAdmin } from "../middleware/auth";

const router = Router();

// GET  /settings — get current system settings (any authenticated user)
router.get("/", requireAuth, getSettings);

// PUT  /settings — update settings (admin only)
router.put("/", requireAuth, requireAdmin, updateSettings);

export default router;
