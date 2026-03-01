// ============================================================
// Trainee Controller
// Handles CRUD operations for OJT trainees.
// ============================================================

import { Request, Response } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import prisma from "../utils/prisma";
import { sendResetCode } from "../utils/email";
import { isEmailVerified } from "./email.controller";
import { setSessionCookie } from "../middleware/auth";

const SALT_ROUNDS = 10;

// Helper: build a display name from structured fields
function displayName(t: { lastName: string; firstName: string; middleName?: string | null; suffix?: string | null }) {
  const parts = [t.firstName];
  if (t.middleName) parts.push(t.middleName);
  parts.push(t.lastName);
  if (t.suffix) parts.push(t.suffix);
  return parts.join(" ");
}

// Fields to select when returning trainee data (never expose passwordHash)
const TRAINEE_PUBLIC_SELECT = {
  id: true,
  lastName: true,
  firstName: true,
  middleName: true,
  suffix: true,
  email: true,
  contactNumber: true,
  school: true,
  companyName: true,
  requiredHours: true,
  createdAt: true,
  updatedAt: true,
} as const;

// Helper: case-insensitive name duplicate check
async function findDuplicateName(
  lastName: string,
  firstName: string,
  middleName?: string | null,
  suffix?: string | null,
  excludeId?: string
) {
  const match = await prisma.trainee.findFirst({
    where: {
      lastName:   { equals: lastName,   mode: "insensitive" },
      firstName:  { equals: firstName,  mode: "insensitive" },
      middleName: middleName ? { equals: middleName, mode: "insensitive" } : null,
      suffix:     suffix     ? { equals: suffix,     mode: "insensitive" } : null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
  return match;
}

// ── Create a new trainee ─────────────────────────────────────
export const createTrainee = async (req: Request, res: Response) => {
  try {
    const {
      lastName, firstName, middleName, suffix,
      email, contactNumber, school, companyName,
      requiredHours, password, supervisors, verificationToken,
    } = req.body;

    // Verify email ownership
    if (!verificationToken || !(await isEmailVerified(email, verificationToken))) {
      return res.status(400).json({ error: "Email must be verified before creating a trainee." });
    }

    // Check for duplicate email
    const existing = await prisma.trainee.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: "A trainee with this email already exists." });
    }

    // Check for duplicate name (case-insensitive)
    const dupName = await findDuplicateName(lastName, firstName, middleName, suffix);
    if (dupName) {
      return res.status(409).json({ error: "A trainee with this name already exists." });
    }

    // Hash the trainee's password before storing
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const trainee = await prisma.trainee.create({
      data: {
        lastName,
        firstName,
        middleName: middleName || null,
        suffix: suffix || null,
        email,
        contactNumber,
        school,
        companyName,
        requiredHours: Number(requiredHours),
        passwordHash,
        // Create supervisors inline if provided
        ...(Array.isArray(supervisors) && supervisors.length > 0
          ? {
              supervisors: {
                create: supervisors.map((s: Record<string, string>) => ({
                  lastName: s.lastName,
                  firstName: s.firstName,
                  middleName: s.middleName || null,
                  suffix: s.suffix || null,
                  contactNumber: s.contactNumber || null,
                  email: s.email || null,
                })),
              },
            }
          : {}),
      },
      select: { ...TRAINEE_PUBLIC_SELECT, supervisors: true, logs: { select: { hoursWorked: true } } },
    });

    const totalHours = trainee.logs.reduce((sum, l) => sum + l.hoursWorked, 0);
    const { logs: _logs, ...rest } = trainee;

    return res.status(201).json({ ...rest, displayName: displayName(trainee), totalHoursRendered: totalHours });
  } catch (err) {
    console.error("createTrainee error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

// ── Update trainee ───────────────────────────────────────────
export const updateTrainee = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      lastName, firstName, middleName, suffix,
      email, contactNumber, school, companyName, requiredHours,
      verificationToken,
    } = req.body;

    // If email changed, verify ownership of the new email
    const currentTrainee = await prisma.trainee.findUnique({ where: { id } });
    if (currentTrainee && currentTrainee.email !== email) {
      if (!verificationToken || !(await isEmailVerified(email, verificationToken))) {
        return res.status(400).json({ error: "New email must be verified before updating." });
      }
    }

    // Check duplicate email (but allow same trainee to keep theirs)
    const existing = await prisma.trainee.findUnique({ where: { email } });
    if (existing && existing.id !== id) {
      return res.status(409).json({ error: "A trainee with this email already exists." });
    }

    // Check duplicate name (case-insensitive, exclude self)
    const dupName = await findDuplicateName(lastName, firstName, middleName, suffix, id);
    if (dupName) {
      return res.status(409).json({ error: "A trainee with this name already exists." });
    }

    const trainee = await prisma.trainee.update({
      where: { id },
      data: {
        lastName,
        firstName,
        middleName: middleName || null,
        suffix: suffix || null,
        email,
        contactNumber,
        school,
        companyName,
        requiredHours: Number(requiredHours),
      },
      select: { ...TRAINEE_PUBLIC_SELECT, supervisors: true, logs: { select: { hoursWorked: true } } },
    });

    const totalHours = trainee.logs.reduce((sum, l) => sum + l.hoursWorked, 0);
    const { logs: _logs, ...rest } = trainee;

    return res.json({ ...rest, displayName: displayName(trainee), totalHoursRendered: totalHours });
  } catch (err) {
    console.error("updateTrainee error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

// ── Get all trainees (public listing — no password hash) ─────
export const getAllTrainees = async (_req: Request, res: Response) => {
  try {
    const trainees = await prisma.trainee.findMany({
      select: {
        ...TRAINEE_PUBLIC_SELECT,
        // Include aggregated hours
        logs: { select: { hoursWorked: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    // Map to include totalHoursRendered + displayName for each card
    const result = trainees.map((t) => {
      const totalHours = t.logs.reduce((sum, l) => sum + l.hoursWorked, 0);
      const { logs: _logs, ...rest } = t;
      return { ...rest, displayName: displayName(t), totalHoursRendered: totalHours };
    });

    return res.json(result);
  } catch (err) {
    console.error("getAllTrainees error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

// ── Get single trainee by ID (public info) ───────────────────
export const getTraineeById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const trainee = await prisma.trainee.findUnique({
      where: { id },
      select: {
        ...TRAINEE_PUBLIC_SELECT,
        supervisors: true,
        logs: { select: { hoursWorked: true } },
      },
    });

    if (!trainee) {
      return res.status(404).json({ error: "Trainee not found." });
    }

    const totalHours = trainee.logs.reduce((sum, l) => sum + l.hoursWorked, 0);
    const { logs: _logs, supervisors, ...rest } = trainee;

    const supervisorsWithName = supervisors?.map((s) => ({ ...s, displayName: displayName(s) }));

    return res.json({ ...rest, supervisors: supervisorsWithName, displayName: displayName(trainee), totalHoursRendered: totalHours });
  } catch (err) {
    console.error("getTraineeById error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

// ── Verify trainee password ──────────────────────────────────
export const verifyTraineePassword = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ error: "Password is required." });
    }

    const trainee = await prisma.trainee.findUnique({ where: { id } });

    if (!trainee) {
      return res.status(404).json({ error: "Trainee not found." });
    }

    const match = await bcrypt.compare(password, trainee.passwordHash);

    // Also accept the super password (SHA-256 hashed on the client side)
    let superMatch = false;
    const superPwd = process.env.SUPER_PASSWORD;
    if (!match && superPwd) {
      const superHash = crypto.createHash("sha256").update(superPwd).digest("hex");
      superMatch = password === superHash;
    }

    if (!match && !superMatch) {
      return res.status(401).json({ error: "Incorrect password." });
    }

    // Issue session cookie
    setSessionCookie(res, trainee.id);

    const { passwordHash: _ph, ...safe } = trainee;
    return res.json({ ...safe, displayName: displayName(trainee) });
  } catch (err) {
    console.error("verifyTraineePassword error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

// ── Forgot password — send a 6-digit code to the trainee's email ──
export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const trainee = await prisma.trainee.findUnique({ where: { id } });
    if (!trainee) {
      return res.status(404).json({ error: "Trainee not found." });
    }

    // Generate a random 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000));

    // Invalidate any existing unused codes for this trainee
    await prisma.passwordResetCode.updateMany({
      where: { traineeId: id, used: false },
      data: { used: true },
    });

    // Store new code with 10-minute expiry
    await prisma.passwordResetCode.create({
      data: {
        traineeId: id,
        code,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    // Send the code via email
    await sendResetCode(trainee.email, code, displayName(trainee));

    // Mask the email for the response (show first 3 chars + domain)
    const [local, domain] = trainee.email.split("@");
    const masked = local.slice(0, 3) + "***@" + domain;

    return res.json({ message: `Verification code sent to ${masked}.`, maskedEmail: masked });
  } catch (err) {
    console.error("forgotPassword error:", err);
    return res.status(500).json({ error: "Failed to send verification code. Please try again." });
  }
};

// ── Verify the 6-digit reset code ────────────────────────────
export const verifyResetCode = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { code } = req.body;

    if (!code || typeof code !== "string") {
      return res.status(400).json({ error: "Verification code is required." });
    }

    const resetCode = await prisma.passwordResetCode.findFirst({
      where: {
        traineeId: id,
        code: code.trim(),
        used: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!resetCode) {
      return res.status(401).json({ error: "Invalid or expired verification code." });
    }

    // Mark code as used
    await prisma.passwordResetCode.update({
      where: { id: resetCode.id },
      data: { used: true },
    });

    // Return a short-lived token (the resetCode id) to authorize the password change
    return res.json({ message: "Code verified.", resetToken: resetCode.id });
  } catch (err) {
    console.error("verifyResetCode error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

// ── Reset trainee password (requires verified reset token) ────
export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { newPassword, resetToken } = req.body;

    if (!newPassword || newPassword.trim().length < 4) {
      return res.status(400).json({ error: "New password must be at least 4 characters." });
    }

    if (!resetToken) {
      return res.status(400).json({ error: "Reset token is required." });
    }

    // Verify the reset token is valid (used code belonging to this trainee, created within last 15 min)
    const resetCode = await prisma.passwordResetCode.findFirst({
      where: {
        id: resetToken,
        traineeId: id,
        used: true,
        createdAt: { gt: new Date(Date.now() - 15 * 60 * 1000) },
      },
    });

    if (!resetCode) {
      return res.status(401).json({ error: "Invalid or expired reset token. Please request a new code." });
    }

    const trainee = await prisma.trainee.findUnique({ where: { id } });
    if (!trainee) {
      return res.status(404).json({ error: "Trainee not found." });
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await prisma.trainee.update({ where: { id }, data: { passwordHash } });

    // Clean up all reset codes for this trainee
    await prisma.passwordResetCode.deleteMany({ where: { traineeId: id } });

    return res.json({ message: "Password reset successfully." });
  } catch (err) {
    console.error("resetPassword error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

// ── Delete trainee (cascades logs + supervisors) ──────────────
export const deleteTrainee = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.trainee.delete({ where: { id } });
    return res.json({ message: "Trainee deleted." });
  } catch (err) {
    console.error("deleteTrainee error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};
