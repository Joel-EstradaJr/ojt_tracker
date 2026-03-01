// ============================================================
// Validation Middleware
// Reusable validators for trainee, supervisor, and log data.
// ============================================================

import { Request, Response, NextFunction } from "express";

// ── Email regex ──────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── Validate Trainee payload ─────────────────────────────────
export function validateTrainee(req: Request, res: Response, next: NextFunction) {
  const { lastName, firstName, email, contactNumber, school, companyName, requiredHours, password } = req.body;

  const errors: string[] = [];

  if (!lastName?.trim()) errors.push("lastName is required.");
  if (!firstName?.trim()) errors.push("firstName is required.");
  if (!email?.trim()) errors.push("email is required.");
  else if (!EMAIL_RE.test(email)) errors.push("email must be a valid format.");
  if (!contactNumber?.trim()) errors.push("contactNumber is required.");
  if (!school?.trim()) errors.push("school is required.");
  if (!companyName?.trim()) errors.push("companyName is required.");
  if (!requiredHours || Number(requiredHours) <= 0) errors.push("requiredHours must be a positive number.");
  if (!password?.trim()) errors.push("password is required.");

  if (errors.length) {
    return res.status(400).json({ error: errors.join(" ") });
  }

  next();
}

// ── Validate Trainee update payload (password not required) ──
export function validateTraineeUpdate(req: Request, res: Response, next: NextFunction) {
  const { lastName, firstName, email, contactNumber, school, companyName, requiredHours } = req.body;

  const errors: string[] = [];

  if (!lastName?.trim()) errors.push("lastName is required.");
  if (!firstName?.trim()) errors.push("firstName is required.");
  if (!email?.trim()) errors.push("email is required.");
  else if (!EMAIL_RE.test(email)) errors.push("email must be a valid format.");
  if (!contactNumber?.trim()) errors.push("contactNumber is required.");
  if (!school?.trim()) errors.push("school is required.");
  if (!companyName?.trim()) errors.push("companyName is required.");
  if (!requiredHours || Number(requiredHours) <= 0) errors.push("requiredHours must be a positive number.");

  if (errors.length) {
    return res.status(400).json({ error: errors.join(" ") });
  }

  next();
}

// ── Validate Supervisor payload ──────────────────────────────
// At least one of contactNumber or email must be provided.
export function validateSupervisor(req: Request, res: Response, next: NextFunction) {
  const { lastName, firstName, contactNumber, email } = req.body;

  const errors: string[] = [];

  if (!lastName?.trim()) errors.push("lastName is required.");
  if (!firstName?.trim()) errors.push("firstName is required.");

  // Business rule: at least one contact method required
  if (!contactNumber?.trim() && !email?.trim()) {
    errors.push("At least one of contactNumber or email must be provided.");
  }

  if (email?.trim() && !EMAIL_RE.test(email)) {
    errors.push("email must be a valid format.");
  }

  if (errors.length) {
    return res.status(400).json({ error: errors.join(" ") });
  }

  next();
}

// ── Validate Log Entry payload ───────────────────────────────
// Enforces all time ordering rules on the server side.
export function validateLogEntry(req: Request, res: Response, next: NextFunction) {
  const { traineeId, date, timeIn, timeOut, lunchStart, lunchEnd, accomplishment } = req.body;

  const errors: string[] = [];

  if (!traineeId) errors.push("traineeId is required.");
  if (!date) errors.push("date is required.");
  if (!timeIn) errors.push("timeIn is required.");
  if (!timeOut) errors.push("timeOut is required.");
  if (!lunchStart) errors.push("lunchStart is required.");
  if (!lunchEnd) errors.push("lunchEnd is required.");
  if (!accomplishment?.trim()) errors.push("accomplishment is required.");

  if (errors.length) {
    return res.status(400).json({ error: errors.join(" ") });
  }

  const tIn = new Date(timeIn).getTime();
  const tOut = new Date(timeOut).getTime();
  const lStart = new Date(lunchStart).getTime();
  const lEnd = new Date(lunchEnd).getTime();

  // Time ordering rules
  if (tOut <= tIn) errors.push("timeOut must be after timeIn.");

  // Allow no-lunch case: lunchStart === lunchEnd
  const hasLunch = lStart !== lEnd;
  if (hasLunch) {
    if (lStart <= tIn) errors.push("lunchStart must be after timeIn.");
    if (lEnd >= tOut) errors.push("lunchEnd must be before timeOut.");
    if (lEnd <= lStart) errors.push("lunchEnd must be after lunchStart.");
  }

  // Calculate hours to ensure non-negative
  const totalMinutes = (tOut - tIn) / 60000;
  const lunchMinutes = hasLunch ? (lEnd - lStart) / 60000 : 0;
  const worked = totalMinutes - lunchMinutes;

  if (worked < 0) errors.push("hoursWorked cannot be negative.");

  if (errors.length) {
    return res.status(400).json({ error: errors.join(" ") });
  }

  next();
}
