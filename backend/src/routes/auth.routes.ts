// ============================================================
// Auth Routes — super password verification + session management
// ============================================================

import { Router, Request, Response } from "express";
import crypto from "crypto";
import bcrypt from "bcrypt";
import { Prisma } from "@prisma/client";
import jwt from "jsonwebtoken";
import prisma from "../utils/prisma";
import { sendResetCode } from "../utils/email";
import { AuthPayload, clearSessionCookie, setSessionCookie } from "../middleware/auth";

const router = Router();
const ACCOUNT_LOCK_THRESHOLD = 15;
const GENERIC_LOGIN_ERROR = "Invalid credentials. Please try again.";
const FORGOT_PASSWORD_GENERIC_SUCCESS = "If the account exists, a verification code has been sent to the registered email.";

function getLockoutMinutes(failedAttempts: number): number | null {
  if (failedAttempts === 12) return 60;
  if (failedAttempts === 10) return 45;
  if (failedAttempts === 8) return 30;
  if (failedAttempts === 6) return 15;
  if (failedAttempts === 3) return 1;
  return null;
}

function normalizePayload(payload: AuthPayload): AuthPayload {
  if (payload.role) return payload;
  return {
    role: "trainee",
    traineeId: (payload as unknown as { traineeId?: string }).traineeId,
  };
}

function buildFullName(t: { firstName: string; middleName?: string | null; lastName: string; suffix?: string | null }) {
  const parts = [t.firstName];
  if (t.middleName) parts.push(t.middleName);
  parts.push(t.lastName);
  if (t.suffix) parts.push(t.suffix);
  return parts.join(" ");
}

function normalizeName(input: string) {
  return input.trim().replace(/\s+/g, " ").toUpperCase();
}

function maskEmail(email: string) {
  const [local = "", domain = ""] = email.split("@");
  if (!local || !domain) return "***";
  return `${local.slice(0, 3)}***@${domain}`;
}

// POST /auth/login — unified login with automatic role detection
router.post("/login", async (req: Request, res: Response) => {
  const { fullName, identifier, password } = req.body as {
    fullName?: string;
    identifier?: string;
    password?: string;
  };

  const loginIdentifier = typeof identifier === "string" && identifier.trim()
    ? identifier.trim()
    : typeof fullName === "string"
      ? fullName.trim()
      : "";

  if (!loginIdentifier) {
    return res.status(400).json({ error: "Full name is required." });
  }

  if (!password) {
    return res.status(400).json({ error: "Password is required." });
  }

  const normalizedLookupName = normalizeName(loginIdentifier);
  const normalizedEmail = loginIdentifier.toLowerCase();
  const isEmailIdentifier = normalizedEmail.includes("@");

  const superName = process.env.SUPER_NAME;
  const superPwd = process.env.SUPER_PASSWORD;
  if (!superName || !superPwd) {
    return res.status(500).json({ error: "Server configuration error." });
  }

  const superHash = crypto.createHash("sha256").update(superPwd).digest("hex");
  if (normalizeName(superName) === normalizedLookupName && password === superHash) {
    setSessionCookie(res, { role: "admin" });
    return res.json({ message: "Logged in.", role: "admin" });
  }

  try {
    const selectedUserFields = {
      id: true,
      role: true,
      firstName: true,
      middleName: true,
      lastName: true,
      suffix: true,
      passwordHash: true,
      failedLoginAttempts: true,
      lockedUntil: true,
    } as const;

    let user = isEmailIdentifier
      ? await prisma.trainee.findUnique({ where: { email: normalizedEmail }, select: selectedUserFields })
      : null;

    if (!user) {
      const users = await prisma.trainee.findMany({ select: selectedUserFields });
      user = users.find((u) => normalizeName(buildFullName(u)) === normalizedLookupName) ?? null;
    }

    if (!user) {
      return res.status(401).json({ error: GENERIC_LOGIN_ERROR });
    }

    if (user.failedLoginAttempts >= ACCOUNT_LOCK_THRESHOLD) {
      return res.status(423).json({
        error: GENERIC_LOGIN_ERROR,
        accountLocked: true,
        lockoutUserId: user.id,
        failedAttempts: user.failedLoginAttempts,
        attemptsRemainingBeforeLock: 0,
      });
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const retryAfterSeconds = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000));
      return res.status(429).json({
        error: GENERIC_LOGIN_ERROR,
        cooldown: true,
        retryAfterSeconds,
        lockoutUserId: user.id,
        lockoutEndsAt: user.lockedUntil.toISOString(),
        failedAttempts: user.failedLoginAttempts,
        attemptsRemainingBeforeLock: Math.max(0, ACCOUNT_LOCK_THRESHOLD - user.failedLoginAttempts),
      });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      const nextFailedAttempts = user.failedLoginAttempts + 1;
      const accountLocked = nextFailedAttempts >= ACCOUNT_LOCK_THRESHOLD;
      const lockoutMinutes = accountLocked ? null : getLockoutMinutes(nextFailedAttempts);
      const lockedUntil = lockoutMinutes ? new Date(Date.now() + lockoutMinutes * 60 * 1000) : null;

      await prisma.trainee.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: nextFailedAttempts,
          lockedUntil,
        },
      });

      if (accountLocked) {
        return res.status(423).json({
          error: GENERIC_LOGIN_ERROR,
          accountLocked: true,
          lockoutUserId: user.id,
          failedAttempts: nextFailedAttempts,
          attemptsRemainingBeforeLock: 0,
        });
      }

      if (lockoutMinutes) {
        const lockoutEndsAt = new Date(Date.now() + lockoutMinutes * 60 * 1000);
        return res.status(429).json({
          error: GENERIC_LOGIN_ERROR,
          cooldown: true,
          retryAfterSeconds: lockoutMinutes * 60,
          lockoutUserId: user.id,
          lockoutEndsAt: lockoutEndsAt.toISOString(),
          failedAttempts: nextFailedAttempts,
          attemptsRemainingBeforeLock: Math.max(0, ACCOUNT_LOCK_THRESHOLD - nextFailedAttempts),
        });
      }

      return res.status(401).json({
        error: GENERIC_LOGIN_ERROR,
        failedAttempts: nextFailedAttempts,
        attemptsRemainingBeforeLock: Math.max(0, ACCOUNT_LOCK_THRESHOLD - nextFailedAttempts),
      });
    }

    if (user.failedLoginAttempts !== 0 || user.lockedUntil) {
      await prisma.trainee.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
    }

    const role = user.role === "admin" ? "admin" : "trainee";
    setSessionCookie(res, role === "admin" ? { role: "admin" } : { role: "trainee", traineeId: user.id });
    return res.json({
      message: "Logged in.",
      role,
      traineeId: role === "trainee" ? user.id : null,
    });
  } catch (err) {
    console.error("login error:", err);

    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2022") {
      return res.status(503).json({
        error: "Server authentication data is not ready. Please contact support.",
      });
    }

    return res.status(500).json({ error: "Internal server error." });
  }
});

// POST /auth/forgot-password/request-code — request reset code by full name
router.post("/forgot-password/request-code", async (req: Request, res: Response) => {
  const { fullName } = req.body as { fullName?: string };

  if (!fullName || typeof fullName !== "string" || !fullName.trim()) {
    return res.status(400).json({ error: "Full name is required." });
  }

  const normalizedLookupName = normalizeName(fullName);

  try {
    const users = await prisma.trainee.findMany({
      select: {
        id: true,
        firstName: true,
        middleName: true,
        lastName: true,
        suffix: true,
        email: true,
      },
    });

    const user = users.find((u) => normalizeName(buildFullName(u)) === normalizedLookupName);
    if (!user) {
      return res.json({ message: FORGOT_PASSWORD_GENERIC_SUCCESS });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));

    await prisma.passwordResetCode.updateMany({
      where: { traineeId: user.id, used: false },
      data: { used: true },
    });

    await prisma.passwordResetCode.create({
      data: {
        traineeId: user.id,
        code,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    const internalKey = req.headers["x-internal-key"] as string | undefined;
    if (internalKey && process.env.EMAIL_INTERNAL_KEY && internalKey === process.env.EMAIL_INTERNAL_KEY) {
      return res.json({
        message: FORGOT_PASSWORD_GENERIC_SUCCESS,
        maskedEmail: maskEmail(user.email),
        code,
        displayName: buildFullName(user),
        email: user.email,
      });
    }

    await sendResetCode(user.email, code, buildFullName(user));

    return res.json({
      message: FORGOT_PASSWORD_GENERIC_SUCCESS,
      maskedEmail: maskEmail(user.email),
    });
  } catch (err) {
    console.error("forgot-password request-code error:", err);
    return res.status(500).json({ error: "Failed to send verification code. Please try again." });
  }
});

// POST /auth/forgot-password/verify-code — verify reset code by full name
router.post("/forgot-password/verify-code", async (req: Request, res: Response) => {
  const { fullName, code } = req.body as { fullName?: string; code?: string };

  if (!fullName || typeof fullName !== "string" || !fullName.trim()) {
    return res.status(400).json({ error: "Full name is required." });
  }

  if (!code || typeof code !== "string") {
    return res.status(400).json({ error: "Verification code is required." });
  }

  try {
    const users = await prisma.trainee.findMany({
      select: {
        id: true,
        firstName: true,
        middleName: true,
        lastName: true,
        suffix: true,
      },
    });
    const user = users.find((u) => normalizeName(buildFullName(u)) === normalizeName(fullName));

    if (!user) {
      return res.status(401).json({ error: "Invalid or expired verification code." });
    }

    const resetCode = await prisma.passwordResetCode.findFirst({
      where: {
        traineeId: user.id,
        code: code.trim(),
        used: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!resetCode) {
      return res.status(401).json({ error: "Invalid or expired verification code." });
    }

    await prisma.passwordResetCode.update({
      where: { id: resetCode.id },
      data: { used: true },
    });

    return res.json({ message: "Code verified.", resetToken: resetCode.id });
  } catch (err) {
    console.error("forgot-password verify-code error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// POST /auth/forgot-password/reset — reset password by full name
router.post("/forgot-password/reset", async (req: Request, res: Response) => {
  const { fullName, resetToken, newPassword, confirmPassword } = req.body as {
    fullName?: string;
    resetToken?: string;
    newPassword?: string;
    confirmPassword?: string;
  };

  if (!fullName || typeof fullName !== "string" || !fullName.trim()) {
    return res.status(400).json({ error: "Full name is required." });
  }

  if (!resetToken || typeof resetToken !== "string") {
    return res.status(400).json({ error: "Reset token is required." });
  }

  if (!newPassword || !confirmPassword) {
    return res.status(400).json({ error: "New password and confirmation are required." });
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: "Passwords do not match." });
  }

  try {
    const users = await prisma.trainee.findMany({
      select: {
        id: true,
        firstName: true,
        middleName: true,
        lastName: true,
        suffix: true,
        passwordHash: true,
      },
    });
    const user = users.find((u) => normalizeName(buildFullName(u)) === normalizeName(fullName));
    if (!user) {
      return res.status(401).json({ error: "Invalid reset request." });
    }

    const resetCode = await prisma.passwordResetCode.findFirst({
      where: {
        id: resetToken,
        traineeId: user.id,
        used: true,
        createdAt: { gt: new Date(Date.now() - 15 * 60 * 1000) },
      },
    });

    if (!resetCode) {
      return res.status(401).json({ error: "Invalid or expired reset token. Please request a new code." });
    }

    const sameAsCurrent = await bcrypt.compare(newPassword, user.passwordHash);
    if (sameAsCurrent) {
      return res.status(400).json({ error: "You cannot reuse a previous password." });
    }

    const previousHashes = await prisma.passwordHistory.findMany({
      where: { traineeId: user.id },
      select: { passwordHash: true },
      orderBy: { createdAt: "desc" },
    });

    for (const entry of previousHashes) {
      if (await bcrypt.compare(newPassword, entry.passwordHash)) {
        return res.status(400).json({ error: "You cannot reuse a previous password." });
      }
    }

    const nextPasswordHash = await bcrypt.hash(newPassword, 10);

    await prisma.$transaction([
      prisma.trainee.update({
        where: { id: user.id },
        data: {
          passwordHash: nextPasswordHash,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      }),
      prisma.passwordHistory.create({
        data: {
          traineeId: user.id,
          passwordHash: user.passwordHash,
        },
      }),
      prisma.passwordResetCode.deleteMany({ where: { traineeId: user.id } }),
    ]);

    return res.json({ message: "Password reset successfully." });
  } catch (err) {
    console.error("forgot-password reset error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// GET /auth/me — inspect current authenticated session
router.get("/me", (req: Request, res: Response) => {
  const token: string | undefined = req.cookies?.ojt_session;

  if (!token) {
    return res.status(401).json({ authenticated: false });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return res.status(500).json({ error: "Server configuration error." });
  }

  try {
    const raw = jwt.verify(token, secret) as AuthPayload & { exp?: number };
    const payload = normalizePayload(raw);
    return res.json({
      authenticated: true,
      role: payload.role,
      traineeId: payload.traineeId ?? null,
      expiresAt: raw.exp ? raw.exp * 1000 : null,
    });
  } catch {
    return res.status(401).json({ authenticated: false });
  }
});

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
    const raw = jwt.verify(token, secret) as AuthPayload & { exp?: number };
    const payload = normalizePayload(raw);

    if (payload.role === "admin") {
      return res.json({
        authenticated: true,
        role: "admin",
        expiresAt: raw.exp ? raw.exp * 1000 : null,
      });
    }

    if (payload.traineeId !== traineeId) {
      return res.status(403).json({ authenticated: false });
    }

    return res.json({
      authenticated: true,
      role: "trainee",
      traineeId,
      expiresAt: raw.exp ? raw.exp * 1000 : null,
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
