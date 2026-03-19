// ============================================================
// Validation Middleware
// Zod-powered validators for trainee, supervisor, and log data.
// ============================================================

import { Request, Response, NextFunction } from "express";
import {
  createTraineeSchema,
  updateTraineeSchema,
  supervisorSchema,
  createLogSchema,
  updateLogSchema,
  sanitizeString,
  formatZodErrors,
} from "../schemas/validation";

// ── Sanitisation middleware ───────────────────────────────────
// Strip XSS / injection chars from every string in req.body.

/**
 * Express middleware — sanitises all string values in req.body
 * before they reach the route handler. Runs on every mutating route.
 */
export function sanitizeBody(req: Request, _res: Response, next: NextFunction) {
  // Password fields must NEVER be sanitized — sanitizeString strips valid password chars (e.g. $)
  const SKIP_FIELDS = new Set(["password", "confirmPassword", "newPassword"]);
  if (req.body && typeof req.body === "object") {
    for (const key of Object.keys(req.body)) {
      if (SKIP_FIELDS.has(key)) continue;
      const v = req.body[key];
      if (typeof v === "string") {
        req.body[key] = sanitizeString(v);
      }
      // Handle nested arrays (e.g. supervisors[])
      if (Array.isArray(v)) {
        req.body[key] = v.map((item: Record<string, unknown>) => {
          if (item && typeof item === "object") {
            const cleaned: Record<string, unknown> = { ...item };
            for (const k of Object.keys(cleaned)) {
              if (typeof cleaned[k] === "string") {
                cleaned[k] = sanitizeString(cleaned[k] as string);
              }
            }
            return cleaned;
          }
          return item;
        });
      }
    }
  }
  next();
}

// ── Validate Trainee (create) ────────────────────────────────
export function validateTrainee(req: Request, res: Response, next: NextFunction) {
  const result = createTraineeSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: formatZodErrors(result.error) });
  }
  // Replace body with parsed + trimmed values
  req.body = result.data;
  next();
}

// ── Validate Trainee (update — no password) ──────────────────
export function validateTraineeUpdate(req: Request, res: Response, next: NextFunction) {
  const result = updateTraineeSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: formatZodErrors(result.error) });
  }
  req.body = result.data;
  next();
}

// ── Validate Supervisor ──────────────────────────────────────
export function validateSupervisor(req: Request, res: Response, next: NextFunction) {
  const result = supervisorSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: formatZodErrors(result.error) });
  }
  req.body = result.data;
  next();
}

// ── Validate Log Entry (create) ──────────────────────────────
export function validateLogEntry(req: Request, res: Response, next: NextFunction) {
  const result = createLogSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: formatZodErrors(result.error) });
  }

  // Additional time-ordering validations that are hard to express in Zod
  const { date, timeIn, timeOut, lunchStart, lunchEnd } = result.data;
  const errors: string[] = [];

  // Prevent future dates
  const entryDate = new Date(date);
  entryDate.setHours(0, 0, 0, 0);
  const todayDate = new Date();
  todayDate.setHours(0, 0, 0, 0);
  if (entryDate > todayDate) errors.push("Date cannot be in the future.");

  const tIn = new Date(timeIn).getTime();
  const tOut = new Date(timeOut).getTime();
  const lStart = new Date(lunchStart).getTime();
  const lEnd = new Date(lunchEnd).getTime();

  if (tOut <= tIn) errors.push("Time Out must be after Time In.");

  // Allow no-lunch case: lunchStart === lunchEnd
  const hasLunch = lStart !== lEnd;
  if (hasLunch) {
    if (lStart <= tIn) errors.push("Lunch Start must be after Time In.");
    if (lEnd >= tOut) errors.push("Lunch End must be before Time Out.");
    if (lEnd <= lStart) errors.push("Lunch End must be after Lunch Start.");
  }

  const totalMinutes = (tOut - tIn) / 60000;
  const lunchMinutes = hasLunch ? (lEnd - lStart) / 60000 : 0;
  const worked = totalMinutes - lunchMinutes;
  if (worked < 0) errors.push("Hours worked cannot be negative.");

  if (errors.length) {
    return res.status(400).json({ error: errors.join(" ") });
  }

  req.body = result.data;
  next();
}

// ── Validate Log Entry (update) ──────────────────────────────
export function validateLogUpdate(req: Request, res: Response, next: NextFunction) {
  const result = updateLogSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: formatZodErrors(result.error) });
  }

  // If all time fields are present, run ordering checks
  const d = result.data;
  if (d.date && d.timeIn && d.timeOut && d.lunchStart && d.lunchEnd) {
    const errors: string[] = [];

    const entryDate = new Date(d.date);
    entryDate.setHours(0, 0, 0, 0);
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    if (entryDate > todayDate) errors.push("Date cannot be in the future.");

    const tIn = new Date(d.timeIn).getTime();
    const tOut = new Date(d.timeOut).getTime();
    const lStart = new Date(d.lunchStart).getTime();
    const lEnd = new Date(d.lunchEnd).getTime();

    if (tOut <= tIn) errors.push("Time Out must be after Time In.");

    const hasLunch = lStart !== lEnd;
    if (hasLunch) {
      if (lStart <= tIn) errors.push("Lunch Start must be after Time In.");
      if (lEnd >= tOut) errors.push("Lunch End must be before Time Out.");
      if (lEnd <= lStart) errors.push("Lunch End must be after Lunch Start.");
    }

    const totalMinutes = (tOut - tIn) / 60000;
    const lunchMinutes = hasLunch ? (lEnd - lStart) / 60000 : 0;
    if (totalMinutes - lunchMinutes < 0) errors.push("Hours worked cannot be negative.");

    if (errors.length) {
      return res.status(400).json({ error: errors.join(" ") });
    }
  }

  req.body = result.data;
  next();
}
