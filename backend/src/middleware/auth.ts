// ============================================================
// Auth Middleware — verifies JWT session cookie
// ============================================================

import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET environment variable is required.");
  return secret;
};

export interface AuthPayload {
  traineeId: string;
}

/**
 * Middleware that requires a valid `ojt_session` HttpOnly cookie
 * containing a JWT with `{ traineeId }`.
 *
 * For routes with a `:traineeId` or `:id` param that looks like a UUID,
 * enforces that the JWT's traineeId matches the route param (prevents
 * cross-trainee access). Routes using `:id` for non-trainee entities
 * (logs, supervisors — shorter IDs or non-UUID format) only check
 * that a valid session exists.
 */
export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const token: string | undefined = req.cookies?.ojt_session;

  if (!token) {
    return res.status(401).json({ error: "Authentication required." });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET()) as AuthPayload;

    // Enforce traineeId match when the route param is a traineeId
    const paramTraineeId = req.params.traineeId ?? req.params.id;
    if (paramTraineeId && payload.traineeId !== paramTraineeId) {
      // Only enforce for UUID-shaped params (trainee IDs are UUIDs)
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(paramTraineeId);
      if (isUUID) {
        return res.status(403).json({ error: "Access denied." });
      }
    }

    // Attach payload for downstream handlers
    (req as Request & { auth: AuthPayload }).auth = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Session expired or invalid." });
  }
};

/**
 * Issue a signed JWT and set it as an HttpOnly cookie on the response.
 */
export function setSessionCookie(res: Response, traineeId: string): void {
  const expiresIn = process.env.JWT_EXPIRY || "30m";
  const token = jwt.sign({ traineeId }, JWT_SECRET(), { expiresIn: expiresIn as string & jwt.SignOptions["expiresIn"] });

  // Parse expiresIn to milliseconds for cookie maxAge
  const msMatch = expiresIn.match(/^(\d+)(m|h|d)$/);
  let maxAgeMs = 30 * 60 * 1000; // default 30 min
  if (msMatch) {
    const n = parseInt(msMatch[1], 10);
    const unit = msMatch[2];
    if (unit === "m") maxAgeMs = n * 60 * 1000;
    else if (unit === "h") maxAgeMs = n * 3600 * 1000;
    else if (unit === "d") maxAgeMs = n * 86400 * 1000;
  }

  res.cookie("ojt_session", token, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: maxAgeMs,
  });
}

/**
 * Clear the session cookie.
 */
export function clearSessionCookie(res: Response): void {
  res.clearCookie("ojt_session", {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
  });
}
