// ============================================================
// Email Routes — email verification for trainee create / edit
// ============================================================

import { Router } from "express";
import { sendVerification, verifyCode } from "../controllers/email.controller";

const router = Router();

router.post("/send-verification", sendVerification);
router.post("/verify-code", verifyCode);

export default router;
