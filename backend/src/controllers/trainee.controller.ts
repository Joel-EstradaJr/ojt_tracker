import { Request, Response } from "express";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { AuditAction, EmailVerificationPurpose, UserRole } from "@prisma/client";
import prisma from "../utils/prisma";
import { sendPendingEmailUpdateCode, sendResetCode, sendTemporaryPassword } from "../utils/email";
import { isEmailVerified } from "./email.controller";
import { setSessionCookie } from "../middleware/auth";
import { createAuditLog } from "../utils/audit";
import { fetchFaceEmbedding, getFaceEngine, normalizeImageBase64 } from "../utils/face";
import { resolveCanonicalEntities } from "../utils/canonical-entities";

const SALT_ROUNDS = 10;
const INITIAL_PASSWORD_REQUIRED_ERROR = "Forgot Password is disabled for this account until the temporary password is changed.";
const ADMIN_DEFAULT_SCHOOL = "N/A";
const ADMIN_DEFAULT_COMPANY = "N/A";
const ADMIN_DEFAULT_REQUIRED_HOURS = 1;

type WorkScheduleMap = Record<string, { start: string; end: string }>;

function displayName(t: { lastName: string; firstName: string; middleName?: string | null; suffix?: string | null }) {
  const parts = [t.firstName];
  if (t.middleName) parts.push(t.middleName);
  parts.push(t.lastName);
  if (t.suffix) parts.push(t.suffix);
  return parts.join(" ");
}

async function findDuplicateName(
  lastName: string,
  firstName: string,
  middleName?: string | null,
  suffix?: string | null,
  excludeId?: string
) {
  return prisma.userProfile.findFirst({
    where: {
      lastName: { equals: lastName, mode: "insensitive" },
      firstName: { equals: firstName, mode: "insensitive" },
      middleName: middleName ? { equals: middleName, mode: "insensitive" } : null,
      suffix: suffix ? { equals: suffix, mode: "insensitive" } : null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
}

function generateTempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#%";
  let result = "";
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function roleToString(role: UserRole): "admin" | "trainee" {
  return role === UserRole.ADMIN ? "admin" : "trainee";
}

function toUserRole(role: "admin" | "trainee"): UserRole {
  return role === "admin" ? UserRole.ADMIN : UserRole.TRAINEE;
}

function parseScheduleTime(value: string): Date {
  return new Date(`1970-01-01T${value}:00`);
}

function toHHmm(date: Date): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function mapSchedule(entries: Array<{ dayOfWeek: number; startTime: Date; endTime: Date }>): WorkScheduleMap {
  const result: WorkScheduleMap = {};
  for (const e of entries) {
    result[String(e.dayOfWeek)] = { start: toHHmm(e.startTime), end: toHHmm(e.endTime) };
  }
  return result;
}

function transformTrainee(trainee: any) {
  const totalHours = (trainee.logs || []).reduce((sum: number, l: { hoursWorked: number }) => sum + l.hoursWorked, 0);
  const supervisors = (trainee.supervisors || []).map((s: any) => ({ ...s, displayName: displayName(s) }));

  let emailVerificationStatus: "verified" | "pending" | "expired" = "verified";
  if (trainee.user.pendingEmail) {
    if (trainee.user.pendingEmailExpiresAt && new Date(trainee.user.pendingEmailExpiresAt).getTime() > Date.now()) {
      emailVerificationStatus = "pending";
    } else {
      emailVerificationStatus = "expired";
    }
  }

  return {
    id: trainee.id,
    role: roleToString(trainee.user.role),
    lastName: trainee.lastName,
    firstName: trainee.firstName,
    middleName: trainee.middleName,
    suffix: trainee.suffix,
    email: trainee.user.email,
    pendingEmail: trainee.user.pendingEmail ?? null,
    pendingEmailRequestedAt: trainee.user.pendingEmailRequestedAt ?? null,
    pendingEmailExpiresAt: trainee.user.pendingEmailExpiresAt ?? null,
    emailVerificationStatus,
    contactNumber: trainee.contactNumber,
    school: trainee.schoolEntity?.name ?? trainee.school,
    companyName: trainee.company?.name ?? "",
    requiredHours: trainee.requiredHours,
    workSchedule: mapSchedule(trainee.workSchedule || []),
    mustChangePassword: trainee.user.mustChangePassword,
    lockedUntil: trainee.user.lockedUntil,
    createdAt: trainee.createdAt,
    updatedAt: trainee.updatedAt,
    displayName: displayName(trainee),
    totalHoursRendered: totalHours,
    supervisors,
  };
}

async function getTraineeWithRelations(id: string) {
  return prisma.userProfile.findUnique({
    where: { id },
    include: {
      user: true,
      schoolEntity: true,
      company: true,
      workSchedule: true,
      supervisors: true,
      logs: { select: { hoursWorked: true } },
    },
  });
}

export const createTrainee = async (req: Request, res: Response) => {
  try {
    const auth = (req as Request & { auth?: { role: "admin" | "trainee" } }).auth;
    const {
      role,
      lastName, firstName, middleName, suffix,
      email, contactNumber, school, companyName,
      requiredHours, workSchedule,
      password, supervisors, verificationToken,
      faceImageBase64,
    } = req.body;

    const resolvedRole: "admin" | "trainee" = auth?.role === "admin"
      ? (role === "admin" ? "admin" : "trainee")
      : "trainee";

    const isTraineeRole = resolvedRole === "trainee";

    if (!auth?.role && role === "admin") {
      return res.status(403).json({ error: "Only admins can create admin users." });
    }

    const isAdminCreating = auth?.role === "admin";
    if (!isAdminCreating) {
      if (!verificationToken || !(await isEmailVerified(email, verificationToken))) {
        return res.status(400).json({ error: "Email must be verified before creating a trainee." });
      }
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: "A trainee with this email already exists." });
    }

    const dupName = await findDuplicateName(lastName, firstName, middleName, suffix);
    if (dupName) {
      return res.status(409).json({ error: "A trainee with this name already exists." });
    }

    // Trainee self-signup requires face enrollment.
    let signupFaceEmbedding: number[] | null = null;
    if (!isAdminCreating && isTraineeRole) {
      if (getFaceEngine() === "off") return res.status(503).json({ error: "Face recognition service is not configured." });

      if (!faceImageBase64 || typeof faceImageBase64 !== "string") {
        return res.status(400).json({ error: "Face registration is required." });
      }

      const normalized = normalizeImageBase64(faceImageBase64);
      if (!normalized || normalized.length < 32) {
        return res.status(400).json({ error: "Invalid face image." });
      }

      if (normalized.length > 2_000_000) {
        return res.status(400).json({ error: "Face image is too large." });
      }

      if (!/^[A-Za-z0-9+/=]+$/.test(normalized)) {
        return res.status(400).json({ error: "Invalid face image encoding." });
      }

      try {
        signupFaceEmbedding = await fetchFaceEmbedding(faceImageBase64);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Face enrollment failed.";
        return res.status(400).json({ error: msg });
      }
    }

    let actualPassword: string;
    let mustChangePassword = false;
    let tempPasswordPlaintext: string | undefined;

    if (isAdminCreating) {
      tempPasswordPlaintext = generateTempPassword();
      actualPassword = crypto.createHash("sha256").update(tempPasswordPlaintext).digest("hex");
      mustChangePassword = true;
    } else {
      if (!password) return res.status(400).json({ error: "Password is required." });
      actualPassword = password;
    }

    const passwordHash = await bcrypt.hash(actualPassword, SALT_ROUNDS);
    const resolvedEntities = await resolveCanonicalEntities(prisma, {
      schoolInput: isTraineeRole ? String(school) : ADMIN_DEFAULT_SCHOOL,
      companyInput: isTraineeRole ? String(companyName) : ADMIN_DEFAULT_COMPANY,
      autoApprove: isAdminCreating,
    });

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          role: toUserRole(resolvedRole),
          passwordHash,
          mustChangePassword,
          ...(signupFaceEmbedding
            ? {
              faceEnabled: true,
              faceAttendanceEnabled: false,
              faceEmbedding: signupFaceEmbedding,
              faceEnrolledAt: new Date(),
            }
            : {}),
        },
      });

      const trainee = await tx.userProfile.create({
        data: {
          userId: user.id,
          lastName,
          firstName,
          middleName: middleName || null,
          suffix: suffix || null,
          contactNumber,
          school: resolvedEntities.school.canonicalName,
          schoolEntityId: resolvedEntities.school.id,
          originalSchoolInput: resolvedEntities.school.originalInput,
          originalCompanyInput: resolvedEntities.company.originalInput,
          companyId: resolvedEntities.company.id,
          requiredHours: isTraineeRole ? Number(requiredHours) : ADMIN_DEFAULT_REQUIRED_HOURS,
        },
      });

      if (isTraineeRole && workSchedule && typeof workSchedule === "object") {
        const entries = Object.entries(workSchedule as WorkScheduleMap)
          .filter(([, v]) => !!v?.start && !!v?.end)
          .map(([day, v]) => ({
            traineeId: trainee.id,
            dayOfWeek: Number(day),
            startTime: parseScheduleTime(v.start),
            endTime: parseScheduleTime(v.end),
          }));
        if (entries.length > 0) {
          await tx.workScheduleEntry.createMany({ data: entries });
        }
      }

      if (isTraineeRole && Array.isArray(supervisors) && supervisors.length > 0) {
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

        await tx.supervisor.createMany({
          data: (supervisors as Record<string, string>[]).map((s) => ({
            traineeId: trainee.id,
            lastName: s.lastName,
            firstName: s.firstName,
            middleName: s.middleName || null,
            suffix: s.suffix || null,
            contactNumber: s.contactNumber || null,
            email: s.email || null,
          })),
        });
      }

      return trainee.id;
    });

    const trainee = await getTraineeWithRelations(created);
    if (!trainee?.user) return res.status(500).json({ error: "Failed to create user." });

    const transformed = transformTrainee(trainee);

    if (isAdminCreating && tempPasswordPlaintext) {
      const name = transformed.displayName;
      try {
        await sendTemporaryPassword(transformed.email, tempPasswordPlaintext, name);
      } catch (emailErr) {
        console.error("Failed to send temp password email:", emailErr);
      }
    }

    return res.status(201).json(transformed);
  } catch (err) {
    console.error("createTrainee error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

export const updateTrainee = async (req: Request, res: Response) => {
  try {
    const auth = (req as Request & { auth?: { role?: "admin" | "trainee"; traineeId?: string } }).auth;
    const isAdminRequester = auth?.role === "admin";
    const { id } = req.params;
    const requestedRole = req.body?.role as string | undefined;
    const {
      lastName, firstName, middleName, suffix,
      email, contactNumber, school, companyName, requiredHours,
      workSchedule,
      verificationToken,
    } = req.body;

    const current = await getTraineeWithRelations(id);
    if (!current?.user) return res.status(404).json({ error: "Trainee not found." });

    if (requestedRole && requestedRole.toLowerCase() !== roleToString(current.user.role)) {
      return res.status(400).json({ error: "Role cannot be changed after user creation." });
    }

    const normalizedNextEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const shouldUsePendingEmailFlow = isAdminRequester && !current.user.mustChangePassword;

    if (normalizedNextEmail && current.user.email !== normalizedNextEmail) {
      if (!isAdminRequester) {
        if (!verificationToken || !(await isEmailVerified(email, verificationToken))) {
          return res.status(400).json({ error: "New email must be verified before updating." });
        }
      }

      const existingUser = await prisma.user.findUnique({ where: { email: normalizedNextEmail } });
      if (existingUser && existingUser.id !== current.userId) {
        return res.status(409).json({ error: "A trainee with this email already exists." });
      }
    }

    const dupName = await findDuplicateName(lastName, firstName, middleName, suffix, id);
    if (dupName) {
      return res.status(409).json({ error: "A trainee with this name already exists." });
    }

    const isTraineeRole = current.user.role === UserRole.TRAINEE;
    const resolvedEntities = isTraineeRole
      ? await resolveCanonicalEntities(prisma, {
        schoolInput: String(school),
        companyInput: String(companyName),
        autoApprove: isAdminRequester,
      })
      : null;

    await prisma.$transaction(async (tx) => {
      const userUpdateData: {
        email?: string;
        pendingEmail?: string | null;
        pendingEmailRequestedAt?: Date | null;
        pendingEmailExpiresAt?: Date | null;
        pendingEmailVerifyAttempts?: number;
        pendingEmailAdminResendRequired?: boolean;
      } = {};

      if (normalizedNextEmail && current.user.email !== normalizedNextEmail) {
        if (shouldUsePendingEmailFlow) {
          userUpdateData.pendingEmail = normalizedNextEmail;
          userUpdateData.pendingEmailRequestedAt = new Date();
          userUpdateData.pendingEmailExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
          userUpdateData.pendingEmailVerifyAttempts = 0;
          userUpdateData.pendingEmailAdminResendRequired = false;
        } else {
          userUpdateData.email = normalizedNextEmail;
          userUpdateData.pendingEmail = null;
          userUpdateData.pendingEmailRequestedAt = null;
          userUpdateData.pendingEmailExpiresAt = null;
          userUpdateData.pendingEmailVerifyAttempts = 0;
          userUpdateData.pendingEmailAdminResendRequired = false;
        }
      }

      if (Object.keys(userUpdateData).length > 0) {
        await tx.user.update({
          where: { id: current.userId },
          data: userUpdateData,
        });
      }

      await tx.userProfile.update({
        where: { id },
        data: {
          lastName,
          firstName,
          middleName: middleName || null,
          suffix: suffix || null,
          contactNumber,
          ...(isTraineeRole
            ? {
              school: resolvedEntities?.school.canonicalName,
              schoolEntityId: resolvedEntities?.school.id,
              originalSchoolInput: resolvedEntities?.school.originalInput,
              originalCompanyInput: resolvedEntities?.company.originalInput,
              companyId: resolvedEntities?.company.id,
              requiredHours: Number(requiredHours),
            }
            : {}),
        },
      });

      if (isTraineeRole && workSchedule && typeof workSchedule === "object") {
        await tx.workScheduleEntry.deleteMany({ where: { traineeId: id } });

        const entries = Object.entries(workSchedule as WorkScheduleMap)
          .filter(([, v]) => !!v?.start && !!v?.end)
          .map(([day, v]) => ({
            traineeId: id,
            dayOfWeek: Number(day),
            startTime: parseScheduleTime(v.start),
            endTime: parseScheduleTime(v.end),
          }));

        if (entries.length > 0) {
          await tx.workScheduleEntry.createMany({ data: entries });
        }
      }
    });

    const trainee = await getTraineeWithRelations(id);
    if (!trainee?.user) return res.status(404).json({ error: "Trainee not found." });

    return res.json(transformTrainee(trainee));
  } catch (err) {
    console.error("updateTrainee error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

export const getAllTrainees = async (_req: Request, res: Response) => {
  try {
    const trainees = await prisma.userProfile.findMany({
      include: {
        user: true,
        schoolEntity: true,
        company: true,
        workSchedule: true,
        supervisors: true,
        logs: { select: { hoursWorked: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json(trainees.map(transformTrainee));
  } catch (err) {
    console.error("getAllTrainees error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

export const getTraineeById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const trainee = await getTraineeWithRelations(id);
    if (!trainee?.user) return res.status(404).json({ error: "Trainee not found." });
    return res.json(transformTrainee(trainee));
  } catch (err) {
    console.error("getTraineeById error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

export const verifyTraineePassword = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { password } = req.body;

    if (!password) return res.status(400).json({ error: "Password is required." });

    const trainee = await getTraineeWithRelations(id);
    if (!trainee?.user) return res.status(404).json({ error: "Trainee not found." });

    const match = await bcrypt.compare(password, trainee.user.passwordHash);

    let superMatch = false;
    const superPwd = process.env.SUPER_PASSWORD;
    if (!match && superPwd) {
      const superHash = crypto.createHash("sha256").update(superPwd).digest("hex");
      superMatch = password === superHash;
    }

    if (!match && !superMatch) {
      return res.status(401).json({ error: "Incorrect password." });
    }

    setSessionCookie(res, { role: roleToString(trainee.user.role), traineeId: trainee.id });
    return res.json(transformTrainee(trainee));
  } catch (err) {
    console.error("verifyTraineePassword error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const trainee = await getTraineeWithRelations(id);
    if (!trainee?.user) return res.status(404).json({ error: "Trainee not found." });

    if (trainee.user.mustChangePassword) {
      return res.status(403).json({ error: INITIAL_PASSWORD_REQUIRED_ERROR });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));

    await prisma.passwordResetCode.updateMany({
      where: { userId: trainee.user.id, used: false },
      data: { used: true },
    });

    await prisma.passwordResetCode.create({
      data: {
        userId: trainee.user.id,
        code,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    const [local, domain] = trainee.user.email.split("@");
    const masked = local.slice(0, 3) + "***@" + domain;

    await sendResetCode(trainee.user.email, code, displayName(trainee));
    return res.json({ message: `Verification code sent to ${masked}.`, maskedEmail: masked });
  } catch (err) {
    console.error("forgotPassword error:", err);
    return res.status(500).json({ error: "Failed to send verification code. Please try again." });
  }
};

export const verifyResetCode = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { code } = req.body;

    if (!code || typeof code !== "string") {
      return res.status(400).json({ error: "Verification code is required." });
    }

    const trainee = await getTraineeWithRelations(id);
    if (!trainee?.user) return res.status(404).json({ error: "Trainee not found." });

    const resetCode = await prisma.passwordResetCode.findFirst({
      where: {
        userId: trainee.user.id,
        code: code.trim(),
        used: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!resetCode) return res.status(401).json({ error: "Invalid or expired verification code." });

    await prisma.passwordResetCode.update({ where: { id: resetCode.id }, data: { used: true } });
    return res.json({ message: "Code verified.", resetToken: resetCode.id });
  } catch (err) {
    console.error("verifyResetCode error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { newPassword, resetToken, confirmPassword } = req.body;

    if (!newPassword || newPassword.trim().length < 4) {
      return res.status(400).json({ error: "New password must be at least 4 characters." });
    }
    if (!resetToken) return res.status(400).json({ error: "Reset token is required." });
    if (confirmPassword && newPassword !== confirmPassword) {
      return res.status(400).json({ error: "Passwords do not match." });
    }

    const trainee = await getTraineeWithRelations(id);
    if (!trainee?.user) return res.status(404).json({ error: "Trainee not found." });
    if (trainee.user.mustChangePassword) return res.status(403).json({ error: INITIAL_PASSWORD_REQUIRED_ERROR });

    const resetCode = await prisma.passwordResetCode.findFirst({
      where: {
        id: resetToken,
        userId: trainee.user.id,
        used: true,
        createdAt: { gt: new Date(Date.now() - 15 * 60 * 1000) },
      },
    });

    if (!resetCode) {
      return res.status(401).json({ error: "Invalid or expired reset token. Please request a new code." });
    }

    const sameAsCurrent = await bcrypt.compare(newPassword, trainee.user.passwordHash);
    if (sameAsCurrent) {
      return res.status(400).json({ error: "You cannot reuse a previous password." });
    }

    const previousHashes = await prisma.passwordHistory.findMany({
      where: { userId: trainee.user.id },
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
      prisma.user.update({
        where: { id: trainee.user.id },
        data: {
          passwordHash,
          mustChangePassword: false,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      }),
      prisma.passwordHistory.create({
        data: {
          userId: trainee.user.id,
          passwordHash: trainee.user.passwordHash,
        },
      }),
      prisma.passwordResetCode.deleteMany({ where: { userId: trainee.user.id } }),
    ]);

    return res.json({ message: "Password reset successfully." });
  } catch (err) {
    console.error("resetPassword error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

export const deleteTrainee = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { currentPassword, typedConfirmation } = req.body as {
      currentPassword?: string;
      typedConfirmation?: string;
    };
    const auth = (req as Request & { auth?: { role: "admin" | "trainee"; traineeId?: string } }).auth;

    if (auth?.role === "admin" && auth.traineeId && auth.traineeId === id) {
      return res.status(403).json({ error: "You cannot delete your own account." });
    }

    const target = await getTraineeWithRelations(id);
    if (!target?.user) return res.status(404).json({ error: "User not found." });

    if (target.user.role === UserRole.ADMIN) {
      if (!currentPassword) {
        return res.status(400).json({ error: "Current password (or super password) is required for admin deletion." });
      }

      const normalizeConfirmation = (value: string) => value.trim().replace(/\s+/g, " ").toUpperCase();
      const expectedConfirmation = `DELETE ${displayName(target)}`;
      if (normalizeConfirmation(typedConfirmation ?? "") !== normalizeConfirmation(expectedConfirmation)) {
        return res.status(400).json({ error: `Type \"${expectedConfirmation}\" to confirm admin deletion.` });
      }

      const remainingAdmins = await prisma.user.count({
        where: {
          role: UserRole.ADMIN,
          trainee: { isNot: null },
          id: { not: target.userId },
        },
      });

      if (remainingAdmins < 1) {
        return res.status(403).json({ error: "Cannot delete the last remaining admin account." });
      }

      let verified = false;
      if (auth?.traineeId) {
        const actingAdmin = await prisma.userProfile.findUnique({
          where: { id: auth.traineeId },
          include: { user: { select: { passwordHash: true } } },
        });

        if (actingAdmin?.user) {
          verified = await bcrypt.compare(currentPassword, actingAdmin.user.passwordHash);
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
      ? await prisma.userProfile.findUnique({
        where: { id: auth.traineeId },
        include: { user: { select: { id: true, role: true, email: true } } },
      })
      : null;

    await prisma.$transaction([
      prisma.userProfile.delete({ where: { id } }),
      prisma.user.delete({ where: { id: target.userId } }),
      createAuditLog({
        actionType: AuditAction.DELETE,
        entityName: "trainees",
        recordId: target.id,
        performedById: actor?.user?.id ?? null,
        oldValues: transformTrainee(target),
        newValues: null,
        metadata: {
          sourceIp: req.ip,
          userAgent: req.headers["user-agent"] ?? null,
          actorRole: auth?.role ?? null,
          actorName: actor ? displayName(actor) : process.env.SUPER_NAME || "Super Admin",
          actorEmail: actor?.user?.email ?? null,
        },
      }),
    ]);

    return res.json({ message: "Trainee deleted." });
  } catch (err) {
    console.error("deleteTrainee error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

export const resendTempPassword = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const trainee = await getTraineeWithRelations(id);
    if (!trainee?.user) return res.status(404).json({ error: "Trainee not found." });

    if (!trainee.user.mustChangePassword) {
      return res.status(400).json({ error: "This user has already set their password." });
    }

    const tempPassword = generateTempPassword();
    const hashedForCompare = crypto.createHash("sha256").update(tempPassword).digest("hex");
    const passwordHash = await bcrypt.hash(hashedForCompare, SALT_ROUNDS);

    await prisma.user.update({ where: { id: trainee.user.id }, data: { passwordHash } });

    const name = displayName(trainee);

    const internalKey = req.headers["x-internal-key"] as string | undefined;
    if (internalKey && process.env.EMAIL_INTERNAL_KEY && internalKey === process.env.EMAIL_INTERNAL_KEY) {
      return res.json({
        message: "Temporary password regenerated.",
        _tempPassword: tempPassword,
        _tempEmail: trainee.user.email,
        _tempDisplayName: name,
      });
    }

    try {
      await sendTemporaryPassword(trainee.user.email, tempPassword, name);
    } catch (emailErr) {
      console.error("Failed to send temp password email:", emailErr);
      return res.status(500).json({ error: "Password regenerated but failed to send email. Please try again." });
    }

    return res.json({ message: `Temporary password sent to ${trainee.user.email}.` });
  } catch (err) {
    console.error("resendTempPassword error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

export const requestPendingEmailVerificationCode = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const auth = (req as Request & { auth?: { role: "admin" | "trainee"; traineeId?: string } }).auth;

    if (!auth?.role) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    if (auth.role !== "admin") {
      return res.status(403).json({ error: "Only admins can resend pending email verification codes." });
    }

    const trainee = await getTraineeWithRelations(id);
    if (!trainee?.user) return res.status(404).json({ error: "Trainee not found." });
    if (!trainee.user.pendingEmail) {
      return res.status(400).json({ error: "No pending email change found for this account." });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await prisma.$transaction([
      prisma.emailVerificationCode.updateMany({
        where: {
          userId: trainee.user.id,
          purpose: EmailVerificationPurpose.EMAIL_UPDATE,
          used: false,
        },
        data: { used: true },
      }),
      prisma.emailVerificationCode.create({
        data: {
          userId: trainee.user.id,
          email: trainee.user.pendingEmail,
          purpose: EmailVerificationPurpose.EMAIL_UPDATE,
          code,
          expiresAt,
        },
      }),
      prisma.user.update({
        where: { id: trainee.user.id },
        data: {
          pendingEmailRequestedAt: new Date(),
          pendingEmailExpiresAt: expiresAt,
          pendingEmailVerifyAttempts: 0,
          pendingEmailAdminResendRequired: false,
        },
      }),
    ]);

    // Send verification code via email. No fallback — fail cleanly on error.
    await sendPendingEmailUpdateCode(trainee.user.pendingEmail, code, displayName(trainee));

    return res.json({ message: "Verification code sent to the pending email address." });
  } catch (err) {
    console.error("requestPendingEmailVerificationCode error:", err);
    return res.status(500).json({ error: "Failed to generate verification code." });
  }
};

export const verifyPendingEmailChange = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { code } = req.body as { code?: string };
    const auth = (req as Request & { auth?: { role: "admin" | "trainee"; traineeId?: string } }).auth;

    if (!auth?.role) {
      return res.status(401).json({ error: "Unauthorized." });
    }

    if (auth.role === "trainee" && auth.traineeId !== id) {
      return res.status(403).json({ error: "You can only verify your own account email change." });
    }

    if (!code || typeof code !== "string") {
      return res.status(400).json({ error: "Verification code is required." });
    }

    const trainee = await getTraineeWithRelations(id);
    if (!trainee?.user) return res.status(404).json({ error: "Trainee not found." });
    if (!trainee.user.pendingEmail) {
      return res.status(400).json({ error: "No pending email change found for this account." });
    }

    if (trainee.user.pendingEmailAdminResendRequired) {
      return res.status(403).json({ error: "Maximum verification attempts reached. Ask your admin to resend a new code." });
    }

    const pendingExpired = trainee.user.pendingEmailExpiresAt && trainee.user.pendingEmailExpiresAt.getTime() <= Date.now();
    if (pendingExpired) {
      await prisma.$transaction([
        prisma.user.update({
          where: { id: trainee.user.id },
          data: {
            pendingEmail: null,
            pendingEmailRequestedAt: null,
            pendingEmailExpiresAt: null,
          },
        }),
        prisma.emailVerificationCode.updateMany({
          where: {
            userId: trainee.user.id,
            purpose: EmailVerificationPurpose.EMAIL_UPDATE,
            used: false,
          },
          data: { used: true },
        }),
      ]);

      return res.status(400).json({ error: "Verification code expired. Ask your admin to update your email again." });
    }

    const verificationCode = await prisma.emailVerificationCode.findFirst({
      where: {
        userId: trainee.user.id,
        email: trainee.user.pendingEmail,
        purpose: EmailVerificationPurpose.EMAIL_UPDATE,
        code: code.trim(),
        used: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!verificationCode) {
      const nextAttempts = (trainee.user.pendingEmailVerifyAttempts || 0) + 1;
      const attemptsRemaining = Math.max(0, 3 - nextAttempts);

      await prisma.user.update({
        where: { id: trainee.user.id },
        data: {
          pendingEmailVerifyAttempts: nextAttempts,
          pendingEmailAdminResendRequired: nextAttempts >= 3,
        },
      });

      if (nextAttempts >= 3) {
        await prisma.emailVerificationCode.updateMany({
          where: {
            userId: trainee.user.id,
            purpose: EmailVerificationPurpose.EMAIL_UPDATE,
            used: false,
          },
          data: { used: true },
        });
        return res.status(403).json({ error: "Maximum verification attempts reached. Ask your admin to resend a new code." });
      }

      return res.status(400).json({ error: `Invalid or expired verification code. ${attemptsRemaining} attempt(s) remaining.` });
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: trainee.user.id },
        data: {
          email: trainee.user.pendingEmail,
          pendingEmail: null,
          pendingEmailRequestedAt: null,
          pendingEmailExpiresAt: null,
          pendingEmailVerifyAttempts: 0,
          pendingEmailAdminResendRequired: false,
        },
      }),
      prisma.emailVerificationCode.update({
        where: { id: verificationCode.id },
        data: { used: true },
      }),
      prisma.emailVerificationCode.updateMany({
        where: {
          userId: trainee.user.id,
          purpose: EmailVerificationPurpose.EMAIL_UPDATE,
          used: false,
        },
        data: { used: true },
      }),
    ]);

    const updated = await getTraineeWithRelations(id);
    if (!updated?.user) {
      return res.status(500).json({ error: "Failed to load updated account." });
    }

    return res.json({
      message: "Email verified successfully. Your new email is now active.",
      trainee: transformTrainee(updated),
    });
  } catch (err) {
    console.error("verifyPendingEmailChange error:", err);
    return res.status(500).json({ error: "Failed to verify pending email change." });
  }
};

