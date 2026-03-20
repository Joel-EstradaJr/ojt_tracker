// ============================================================
// Trainee Controller
// Handles CRUD operations for OJT trainees.
// ============================================================

import { Request, Response } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { AuditAction } from "@prisma/client";
import prisma from "../utils/prisma";
import { sendResetCode, sendTemporaryPassword } from "../utils/email";
import { isEmailVerified } from "./email.controller";
import { setSessionCookie } from "../middleware/auth";
import { createAuditLog } from "../utils/audit";

const SALT_ROUNDS = 10;
const INITIAL_PASSWORD_REQUIRED_ERROR = "Forgot Password is disabled for this account until the temporary password is changed.";

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
  role: true,
  lastName: true,
  firstName: true,
  middleName: true,
  suffix: true,
  email: true,
  contactNumber: true,
  school: true,
  companyName: true,
  requiredHours: true,
  workSchedule: true,
  mustChangePassword: true,
  lockedUntil: true,
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
      lastName: { equals: lastName, mode: "insensitive" },
      firstName: { equals: firstName, mode: "insensitive" },
      middleName: middleName ? { equals: middleName, mode: "insensitive" } : null,
      suffix: suffix ? { equals: suffix, mode: "insensitive" } : null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
  return match;
}

// Helper: generate a random temporary password (12 chars)
function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#%';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// ── Create a new trainee ─────────────────────────────────────
export const createTrainee = async (req: Request, res: Response) => {
  try {
    const auth = (req as Request & { auth?: { role: "admin" | "trainee" } }).auth;
    const {
      role,
      lastName, firstName, middleName, suffix,
      email, contactNumber, school, companyName,
      requiredHours, workSchedule,
      password, supervisors, verificationToken,
    } = req.body;

    const resolvedRole: "admin" | "trainee" = auth?.role === "admin"
      ? (role === "admin" ? "admin" : "trainee")
      : "trainee";

    if (!auth?.role && role === "admin") {
      return res.status(403).json({ error: "Only admins can create admin users." });
    }

    const isAdminCreating = auth?.role === "admin";

    // Email verification: skip when admin is creating the user
    if (!isAdminCreating) {
      if (!verificationToken || !(await isEmailVerified(email, verificationToken))) {
        return res.status(400).json({ error: "Email must be verified before creating a trainee." });
      }
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

    // Determine password: admin creates → auto-generate temp password; self-signup → use provided
    let actualPassword: string;
    let mustChangePassword = false;
    let tempPasswordPlaintext: string | undefined;

    if (isAdminCreating) {
      tempPasswordPlaintext = generateTempPassword();
      // SHA-256 hash first to match frontend login flow (frontend sends sha256(password))
      actualPassword = crypto.createHash("sha256").update(tempPasswordPlaintext).digest("hex");
      mustChangePassword = true;
    } else {
      if (!password) {
        return res.status(400).json({ error: "Password is required." });
      }
      actualPassword = password; // already SHA-256 hashed by frontend
    }

    const passwordHash = await bcrypt.hash(actualPassword, SALT_ROUNDS);

    const trainee = await prisma.trainee.create({
      data: {
        role: resolvedRole,
        lastName,
        firstName,
        middleName: middleName || null,
        suffix: suffix || null,
        email,
        contactNumber,
        school,
        companyName,
        requiredHours: Number(requiredHours),
        ...(workSchedule ? { workSchedule } : {}),
        passwordHash,
        mustChangePassword,
        // Check for duplicate supervisors within the provided list
        ...(Array.isArray(supervisors) && supervisors.length > 0
          ? (() => {
            const seen = new Set<string>();
            for (const s of supervisors as Record<string, string>[]) {
              const key = [s.firstName, s.middleName, s.lastName, s.suffix]
                .map((v) => (v ?? "").trim().toLowerCase())
                .join("|");
              if (seen.has(key)) {
                throw new Error(`Duplicate supervisor: "${[s.firstName, s.middleName, s.lastName, s.suffix].filter(Boolean).join(" ")}".`);
              }
              seen.add(key);
            }
            return {
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
            };
          })()
          : {}),
      },
      select: { ...TRAINEE_PUBLIC_SELECT, supervisors: true, logs: { select: { hoursWorked: true } } },
    });

    // Send temporary password email when admin creates the user
    if (isAdminCreating && tempPasswordPlaintext) {
      const name = displayName(trainee);
      const internalKey = req.headers["x-internal-key"] as string | undefined;
      if (internalKey && process.env.EMAIL_INTERNAL_KEY && internalKey === process.env.EMAIL_INTERNAL_KEY) {
        // Vercel proxy: return temp password + email for Vercel to send
        const totalHours = trainee.logs.reduce((sum, l) => sum + l.hoursWorked, 0);
        const { logs: _logs, ...rest } = trainee;
        return res.status(201).json({
          ...rest,
          displayName: name,
          totalHoursRendered: totalHours,
          _tempPassword: tempPasswordPlaintext,
          _tempEmail: email,
          _tempDisplayName: name,
        });
      }
      // Direct call (local dev) — send email via SMTP
      try {
        await sendTemporaryPassword(email, tempPasswordPlaintext, name);
      } catch (emailErr) {
        console.error("Failed to send temp password email:", emailErr);
        // User was still created — log the error but don't fail the request
      }
    }

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
    const auth = (req as Request & { auth?: { role: "admin" | "trainee" } }).auth;
    const { id } = req.params;
    const {
      role,
      lastName, firstName, middleName, suffix,
      email, contactNumber, school, companyName, requiredHours,
      workSchedule,
      verificationToken,
    } = req.body;

    if (role && auth?.role !== "admin") {
      return res.status(403).json({ error: "Only admins can edit user roles." });
    }

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
        ...(auth?.role === "admin" && role ? { role } : {}),
        lastName,
        firstName,
        middleName: middleName || null,
        suffix: suffix || null,
        email,
        contactNumber,
        school,
        companyName,
        requiredHours: Number(requiredHours),
        ...(workSchedule ? { workSchedule } : {}),
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
    setSessionCookie(res, { role: "trainee", traineeId: trainee.id });

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

    if (trainee.mustChangePassword) {
      return res.status(403).json({ error: INITIAL_PASSWORD_REQUIRED_ERROR });
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

    // Mask the email for the response (show first 3 chars + domain)
    const [local, domain] = trainee.email.split("@");
    const masked = local.slice(0, 3) + "***@" + domain;

    // If called from the Vercel API route with internal key,
    // return the code — Vercel will handle email delivery.
    const internalKey = req.headers["x-internal-key"] as string | undefined;
    if (internalKey && process.env.EMAIL_INTERNAL_KEY && internalKey === process.env.EMAIL_INTERNAL_KEY) {
      return res.json({
        message: `Verification code sent to ${masked}.`,
        maskedEmail: masked,
        code,
        displayName: displayName(trainee),
        email: trainee.email,
      });
    }

    // Direct call (local dev) — send email via SMTP
    await sendResetCode(trainee.email, code, displayName(trainee));

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
    const { newPassword, resetToken, confirmPassword } = req.body;

    if (!newPassword || newPassword.trim().length < 4) {
      return res.status(400).json({ error: "New password must be at least 4 characters." });
    }

    if (!resetToken) {
      return res.status(400).json({ error: "Reset token is required." });
    }

    if (confirmPassword && newPassword !== confirmPassword) {
      return res.status(400).json({ error: "Passwords do not match." });
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

    if (trainee.mustChangePassword) {
      return res.status(403).json({ error: INITIAL_PASSWORD_REQUIRED_ERROR });
    }

    const sameAsCurrent = await bcrypt.compare(newPassword, trainee.passwordHash);
    if (sameAsCurrent) {
      return res.status(400).json({ error: "You cannot reuse a previous password." });
    }

    const previousHashes = await prisma.passwordHistory.findMany({
      where: { traineeId: id },
      select: { passwordHash: true },
      orderBy: { createdAt: "desc" },
    });

    for (const entry of previousHashes) {
      if (await bcrypt.compare(newPassword, entry.passwordHash)) {
        return res.status(400).json({ error: "You cannot reuse a previous password." });
      }
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await prisma.$transaction([
      prisma.trainee.update({
        where: { id },
        data: {
          passwordHash,
          mustChangePassword: false,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      }),
      prisma.passwordHistory.create({
        data: {
          traineeId: id,
          passwordHash: trainee.passwordHash,
        },
      }),
      // Clean up all reset codes for this trainee
      prisma.passwordResetCode.deleteMany({ where: { traineeId: id } }),
    ]);

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
    const { currentPassword, typedConfirmation } = req.body as {
      currentPassword?: string;
      typedConfirmation?: string;
    };
    const auth = (req as Request & { auth?: { role: "admin" | "trainee"; traineeId?: string } }).auth;

    if (auth?.role === "admin" && auth.traineeId && auth.traineeId === id) {
      return res.status(403).json({ error: "You cannot delete your own account while logged in." });
    }

    const target = await prisma.trainee.findUnique({
      where: { id },
      select: {
        id: true,
        role: true,
        firstName: true,
        middleName: true,
        lastName: true,
        suffix: true,
        email: true,
        contactNumber: true,
        school: true,
        companyName: true,
        requiredHours: true,
        workSchedule: true,
        mustChangePassword: true,
        failedLoginAttempts: true,
        lockedUntil: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!target) {
      return res.status(404).json({ error: "User not found." });
    }

    if (target.role === "admin") {
      if (!currentPassword) {
        return res.status(400).json({ error: "Current password (or super password) is required for admin deletion." });
      }

      const normalizeConfirmation = (value: string) => value.trim().replace(/\s+/g, " ").toUpperCase();
      const expectedConfirmation = `DELETE ${displayName(target)}`;
      if (normalizeConfirmation(typedConfirmation ?? "") !== normalizeConfirmation(expectedConfirmation)) {
        return res.status(400).json({ error: `Type \"${expectedConfirmation}\" to confirm admin deletion.` });
      }

      const remainingAdmins = await prisma.trainee.count({
        where: {
          role: "admin",
          id: { not: id },
        },
      });

      if (remainingAdmins < 1) {
        return res.status(403).json({ error: "Cannot delete the last remaining admin account." });
      }

      let verified = false;

      if (auth?.traineeId) {
        const actingAdmin = await prisma.trainee.findUnique({
          where: { id: auth.traineeId },
          select: { passwordHash: true },
        });

        if (actingAdmin) {
          verified = await bcrypt.compare(currentPassword, actingAdmin.passwordHash);
        }
      }

      const superPwd = process.env.SUPER_PASSWORD;
      if (!verified && superPwd) {
        const superHash = crypto.createHash("sha256").update(superPwd).digest("hex");
        verified = currentPassword === superHash;
      }

      if (!verified) {
        return res.status(401).json({ error: "Password confirmation failed for admin deletion." });
      }
    }

    const actor = auth?.traineeId
      ? await prisma.trainee.findUnique({
        where: { id: auth.traineeId },
        select: {
          id: true,
          role: true,
          firstName: true,
          middleName: true,
          lastName: true,
          suffix: true,
          email: true,
        },
      })
      : null;

    await prisma.$transaction([
      prisma.trainee.delete({ where: { id } }),
      createAuditLog({
        actionType: AuditAction.DELETE,
        entityName: "trainees",
        recordId: target.id,
        performedById: auth?.traineeId ?? null,
        oldValues: target,
        newValues: null,
        metadata: {
          sourceIp: req.ip,
          userAgent: req.headers["user-agent"] ?? null,
          actorRole: auth?.role ?? null,
          actorName: actor ? displayName(actor) : process.env.SUPER_NAME || "Super Admin",
          actorEmail: actor?.email ?? null,
        },
      }),
    ]);

    return res.json({ message: "Trainee deleted." });
  } catch (err) {
    console.error("deleteTrainee error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

// ── Resend temporary password ─────────────────────────────────
export const resendTempPassword = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const trainee = await prisma.trainee.findUnique({ where: { id } });
    if (!trainee) {
      return res.status(404).json({ error: "Trainee not found." });
    }

    if (!trainee.mustChangePassword) {
      return res.status(400).json({ error: "This user has already set their password." });
    }

    // Generate a new temporary password
    const tempPassword = generateTempPassword();
    // SHA-256 hash first to match frontend login flow (frontend sends sha256(password))
    const hashedForCompare = crypto.createHash("sha256").update(tempPassword).digest("hex");
    const passwordHash = await bcrypt.hash(hashedForCompare, SALT_ROUNDS);

    // Update the user's password hash
    await prisma.trainee.update({
      where: { id },
      data: { passwordHash },
    });

    const name = displayName(trainee);

    // If called via Vercel proxy, return temp password for Vercel to send
    const internalKey = req.headers["x-internal-key"] as string | undefined;
    if (internalKey && process.env.EMAIL_INTERNAL_KEY && internalKey === process.env.EMAIL_INTERNAL_KEY) {
      return res.json({
        message: "Temporary password regenerated.",
        _tempPassword: tempPassword,
        _tempEmail: trainee.email,
        _tempDisplayName: name,
      });
    }

    // Direct call (local dev) — send email via SMTP
    try {
      await sendTemporaryPassword(trainee.email, tempPassword, name);
    } catch (emailErr) {
      console.error("Failed to send temp password email:", emailErr);
      return res.status(500).json({ error: "Password regenerated but failed to send email. Please try again." });
    }

    return res.json({ message: `Temporary password sent to ${trainee.email}.` });
  } catch (err) {
    console.error("resendTempPassword error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};
