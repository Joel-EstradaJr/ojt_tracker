// ============================================================
// Email Verification Controller — sends and verifies 6-digit
// codes to confirm email ownership before trainee create/edit.
// ============================================================

import { Request, Response } from "express";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import { sendEmailVerificationCode } from "../utils/email";

const prisma = new PrismaClient();

/**
 * POST /email/send-verification
 * Body: { email: string }
 * Generates a 6-digit code, stores it, emails it, returns success.
 */
export async function sendVerification(req: Request, res: Response) {
  try {
    const { email } = req.body;

    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "Email is required." });
    }

    // Generate a random 6-digit code
    const code = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    // Invalidate any previous unused codes for this email
    await prisma.emailVerificationCode.updateMany({
      where: { email: email.toLowerCase(), used: false },
      data: { used: true },
    });

    // Store the new code
    await prisma.emailVerificationCode.create({
      data: {
        email: email.toLowerCase(),
        code,
        expiresAt,
      },
    });

    // Send the email
    await sendEmailVerificationCode(email, code);

    return res.json({ message: "Verification code sent." });
  } catch (err) {
    console.error("sendVerification error:", err);
    return res.status(500).json({ error: "Failed to send verification code." });
  }
}

/**
 * POST /email/verify-code
 * Body: { email: string, code: string }
 * Validates the code and returns a verificationToken (the code record's UUID).
 */
export async function verifyCode(req: Request, res: Response) {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ error: "Email and code are required." });
    }

    const record = await prisma.emailVerificationCode.findFirst({
      where: {
        email: email.toLowerCase(),
        code,
        used: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!record) {
      return res.status(400).json({ error: "Invalid or expired verification code." });
    }

    // Mark as used
    await prisma.emailVerificationCode.update({
      where: { id: record.id },
      data: { used: true },
    });

    return res.json({
      message: "Email verified successfully.",
      verificationToken: record.id,
    });
  } catch (err) {
    console.error("verifyCode error:", err);
    return res.status(500).json({ error: "Failed to verify code." });
  }
}

/**
 * Utility: check if a verificationToken is valid for a given email.
 * Used by trainee create/update to confirm the email was verified.
 */
export async function isEmailVerified(email: string, verificationToken: string): Promise<boolean> {
  const record = await prisma.emailVerificationCode.findFirst({
    where: {
      id: verificationToken,
      email: email.toLowerCase(),
      used: true,
      // Token must have been created within the last 30 minutes
      createdAt: { gt: new Date(Date.now() - 30 * 60 * 1000) },
    },
  });
  return !!record;
}
