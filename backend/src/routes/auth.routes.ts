// ============================================================
// Auth Routes — super password verification + session management
// ============================================================

import { Router, Request, Response } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { AuthPayload, clearSessionCookie } from "../middleware/auth";

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

// GET /auth/session/:traineeId — check if current session is valid for this trainee
router.get("/session/:traineeId", (req: Request, res: Response) => {
  const token: string | undefined = req.cookies?.ojt_session;
  const { traineeId } = req.params;

  if (!token) {
    return res.status(401).json({ authenticated: false });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return res.status(500).json({ error: "Server configuration error." });
  }

  try {
    const payload = jwt.verify(token, secret) as AuthPayload & { exp?: number };
    if (payload.traineeId !== traineeId) {
      return res.status(403).json({ authenticated: false });
    }
    return res.json({
      authenticated: true,
      expiresAt: payload.exp ? payload.exp * 1000 : null,
    });
  } catch {
    return res.status(401).json({ authenticated: false });
  }
});

// POST /auth/logout — clear the session cookie
router.post("/logout", (_req: Request, res: Response) => {
  clearSessionCookie(res);
  return res.json({ message: "Logged out." });
});

export default router;
