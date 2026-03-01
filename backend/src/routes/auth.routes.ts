// ============================================================
// Auth Routes — super password verification
// ============================================================

import { Router, Request, Response } from "express";
import crypto from "crypto";

const router = Router();

// POST /auth/verify-super — verify the super password
router.post("/verify-super", (req: Request, res: Response) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ error: "Password is required." });
  }

  const superPwd = process.env.SUPER_PASSWORD;
  if (!superPwd) {
    return res.status(500).json({ error: "Server configuration error." });
  }

  const superHash = crypto.createHash("sha256").update(superPwd).digest("hex");

  if (password !== superHash) {
    return res.status(401).json({ error: "Incorrect password." });
  }

  return res.json({ message: "Verified." });
});

export default router;
