// ============================================================
// Auth Middleware â€” verifies JWT session cookie
// ============================================================

import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { UserRole } from "@prisma/client";
import prisma from "../utils/prisma";

const JWT_SECRET = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET environment variable is required.");
  return secret;
};

export interface AuthPayload {
  role: "admin" | "trainee";
  traineeId?: string;
}

/**
 * Middleware that requires a valid `ojt_session` HttpOnly cookie
 * containing a JWT with `{ traineeId }`.
 *
 * For routes with a `:traineeId` param (and `/trainees/:id`), enforces
 * that the JWT's traineeId matches the route param (prevents cross-trainee
 * access). Routes using `:id` for non-trainee entities (like log IDs)
 * only check that a valid session exists.
 */
export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  const token: string | undefined = req.cookies?.ojt_session;

  if (!token) {
    return res.status(401).json({ error: "Authentication required." });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET()) as AuthPayload;

    // Backward compatibility for older tokens that only had traineeId
    const normalized: AuthPayload = payload.role
      ? payload
      : { role: "trainee", traineeId: (payload as unknown as { traineeId?: string }).traineeId };

    if (normalized.traineeId) {
      const trainee = await prisma.userProfile.findUnique({
        where: { id: normalized.traineeId },
        include: { user: { select: { role: true } } },
      });

      const mappedRole = trainee?.user?.role === UserRole.ADMIN ? "admin" : "trainee";
      if (!trainee?.user || mappedRole !== normalized.role) {
        return res.status(401).json({ error: "Session expired or invalid." });
      }
    }

    if (normalized.role === "admin") {
      (req as Request & { auth: AuthPayload }).auth = normalized;
      return next();
    }

    if (!normalized.traineeId) {
      return res.status(401).json({ error: "Session expired or invalid." });
    }

    // Enforce traineeId match only for explicit trainee-id params.
    const traineeRouteId = req.baseUrl.includes("/trainees") ? req.params.id : undefined;
    const paramTraineeId = req.params.traineeId ?? traineeRouteId;
    if (paramTraineeId && normalized.traineeId !== paramTraineeId) {
      // Only enforce for UUID-shaped params (trainee IDs are UUIDs)
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(paramTraineeId);
      if (isUUID) {
        return res.status(403).json({ error: "Access denied." });
      }
    }

    // Attach payload for downstream handlers
    (req as Request & { auth: AuthPayload }).auth = normalized;
    next();
  } catch {
    return res.status(401).json({ error: "Session expired or invalid." });
  }
};

export const attachAuthIfPresent = (req: Request, _res: Response, next: NextFunction) => {
  const token: string | undefined = req.cookies?.ojt_session;
  if (!token) return next();

  try {
    const payload = jwt.verify(token, JWT_SECRET()) as AuthPayload;
    const normalized: AuthPayload = payload.role
      ? payload
      : { role: "trainee", traineeId: (payload as unknown as { traineeId?: string }).traineeId };
    (req as Request & { auth: AuthPayload }).auth = normalized;
  } catch {
    // Ignore invalid optional sessions
  }

  next();
};

export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  const auth = (req as Request & { auth?: AuthPayload }).auth;
  if (!auth || auth.role !== "admin") {
    return res.status(403).json({ error: "Admin access required." });
  }
  next();
};

/**
 * Issue a signed JWT and set it as an HttpOnly cookie on the response.
 */
export function setSessionCookie(res: Response, payload: AuthPayload): void {
  const expiresIn = process.env.JWT_EXPIRY || "30m";
  const token = jwt.sign(payload, JWT_SECRET(), { expiresIn: expiresIn as string & jwt.SignOptions["expiresIn"] });

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

