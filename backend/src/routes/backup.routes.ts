import { Router } from "express";
import { importBackup, exportBackup, verifyBackupSuperPassword } from "../controllers/backup.controller";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { uploadBackup } from "../middleware/upload";

const router = Router();

router.post("/verify-super", requireAuth, requireAdmin, verifyBackupSuperPassword);
router.get("/export", requireAuth, requireAdmin, exportBackup);
router.post("/import", requireAuth, requireAdmin, uploadBackup.single("file"), importBackup);

export default router;
