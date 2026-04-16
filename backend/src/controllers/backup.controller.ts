import { Request, Response } from "express";
import { parse } from "csv-parse/sync";
import { format } from "date-fns";
import JSZip from "jszip";
import crypto from "crypto";
import { AuditAction, EmailVerificationPurpose, OvertimeType, UserRole } from "@prisma/client";
import prisma from "../utils/prisma";

type CsvRow = Record<string, string>;

interface ImportSummary {
  imported: number;
  skipped: number;
  failed: number;
}

interface ImportStats {
  companies: ImportSummary;
  users: ImportSummary;
  trainees: ImportSummary;
  workScheduleEntries: ImportSummary;
  supervisors: ImportSummary;
  logEntries: ImportSummary;
  overtimeLedger: ImportSummary;
  passwordHistory: ImportSummary;
  passwordResetCodes: ImportSummary;
  emailVerificationCodes: ImportSummary;
  auditLogs: ImportSummary;
  systemSettings: ImportSummary;
  totals: ImportSummary;
  failures: Array<{ table: string; reason: string; row: number }>;
}

const MAX_FAILURES = 200;

function emptySummary(): ImportSummary {
  return { imported: 0, skipped: 0, failed: 0 };
}

function initStats(): ImportStats {
  return {
    companies: emptySummary(),
    users: emptySummary(),
    trainees: emptySummary(),
    workScheduleEntries: emptySummary(),
    supervisors: emptySummary(),
    logEntries: emptySummary(),
    overtimeLedger: emptySummary(),
    passwordHistory: emptySummary(),
    passwordResetCodes: emptySummary(),
    emailVerificationCodes: emptySummary(),
    auditLogs: emptySummary(),
    systemSettings: emptySummary(),
    totals: emptySummary(),
    failures: [],
  };
}

function addFailure(stats: ImportStats, table: string, row: number, reason: string) {
  if (stats.failures.length < MAX_FAILURES) {
    stats.failures.push({ table, row, reason });
  }
}

function updateTotals(stats: ImportStats) {
  const keys = [
    "companies",
    "users",
    "trainees",
    "workScheduleEntries",
    "supervisors",
    "logEntries",
    "overtimeLedger",
    "passwordHistory",
    "passwordResetCodes",
    "emailVerificationCodes",
    "auditLogs",
    "systemSettings",
  ] as const;

  stats.totals.imported = keys.reduce((sum, key) => sum + stats[key].imported, 0);
  stats.totals.skipped = keys.reduce((sum, key) => sum + stats[key].skipped, 0);
  stats.totals.failed = keys.reduce((sum, key) => sum + stats[key].failed, 0);
}

function csvVal(v: unknown): string {
  const text = v === null || v === undefined ? "" : String(v);
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const lines: string[] = [];
  lines.push(headers.join(","));
  for (const row of rows) {
    lines.push(headers.map((h) => csvVal(row[h])).join(","));
  }
  return lines.join("\n");
}

function parseCsv(buffer: Buffer): CsvRow[] {
  return parse(buffer.toString("utf-8"), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as CsvRow[];
}

function normalizeCompanyName(name: string): string {
  return name.trim().toUpperCase();
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toBoolean(value: string | undefined): boolean {
  return (value || "").trim().toLowerCase() === "true";
}

function parseMaybeDate(value: string | undefined): Date | null {
  if (!value || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseFloatSafe(value: string | undefined): number {
  const num = Number(value ?? "0");
  return Number.isFinite(num) ? num : 0;
}

function parseIntSafe(value: string | undefined): number {
  const num = parseInt(value ?? "0", 10);
  return Number.isFinite(num) ? num : 0;
}

function dateOnlyKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function isValidSuperPasswordHash(hash: string | undefined): boolean {
  if (!hash) return false;
  const superPwd = process.env.SUPER_PASSWORD;
  if (!superPwd) return false;
  const expectedHash = crypto.createHash("sha256").update(superPwd).digest("hex");
  return hash === expectedHash;
}

function getHeaderHash(req: Request): string | undefined {
  const header = req.headers["x-super-password"];
  if (typeof header === "string") return header;
  if (Array.isArray(header)) return header[0];
  return undefined;
}

async function exportDatabaseAsZip(): Promise<Buffer> {
  const [
    companies,
    users,
    trainees,
    workScheduleEntries,
    supervisors,
    logEntries,
    overtimeLedger,
    passwordHistory,
    passwordResetCodes,
    emailVerificationCodes,
    auditLogs,
    systemSettings,
  ] = await Promise.all([
    prisma.company.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.userProfile.findMany({
      include: { user: { select: { email: true } }, company: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.workScheduleEntry.findMany({
      include: { trainee: { include: { user: { select: { email: true } } } } },
      orderBy: [{ traineeId: "asc" }, { dayOfWeek: "asc" }],
    }),
    prisma.supervisor.findMany({
      include: { trainee: { include: { user: { select: { email: true } } } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.logEntry.findMany({
      include: { trainee: { include: { user: { select: { email: true } } } } },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    }),
    prisma.overtimeLedger.findMany({
      include: {
        trainee: { include: { user: { select: { email: true } } } },
        sourceLog: { select: { date: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.passwordHistory.findMany({ include: { user: { select: { email: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.passwordResetCode.findMany({ include: { user: { select: { email: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.emailVerificationCode.findMany({ include: { user: { select: { email: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.auditLog.findMany({ include: { performedBy: { select: { email: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.systemSettings.findMany(),
  ]);

  const zip = new JSZip();

  zip.file("companies.csv", toCsv(
    ["name", "createdAt", "updatedAt"],
    companies.map((c) => ({
      name: c.name,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    })),
  ));

  zip.file("users.csv", toCsv(
    [
      "email",
      "role",
      "passwordHash",
      "mustChangePassword",
      "failedLoginAttempts",
      "lockedUntil",
      "pendingEmail",
      "pendingEmailRequestedAt",
      "pendingEmailExpiresAt",
      "pendingEmailVerifyAttempts",
      "pendingEmailAdminResendRequired",
      "createdAt",
      "updatedAt",
    ],
    users.map((u) => ({
      email: u.email,
      role: u.role,
      passwordHash: u.passwordHash,
      mustChangePassword: u.mustChangePassword,
      failedLoginAttempts: u.failedLoginAttempts,
      lockedUntil: u.lockedUntil?.toISOString() ?? "",
      pendingEmail: u.pendingEmail ?? "",
      pendingEmailRequestedAt: u.pendingEmailRequestedAt?.toISOString() ?? "",
      pendingEmailExpiresAt: u.pendingEmailExpiresAt?.toISOString() ?? "",
      pendingEmailVerifyAttempts: u.pendingEmailVerifyAttempts,
      pendingEmailAdminResendRequired: u.pendingEmailAdminResendRequired,
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
    })),
  ));

  zip.file("trainees.csv", toCsv(
    [
      "userEmail",
      "firstName",
      "middleName",
      "lastName",
      "suffix",
      "contactNumber",
      "school",
      "companyName",
      "requiredHours",
      "createdAt",
      "updatedAt",
    ],
    trainees.map((t) => ({
      userEmail: t.user.email,
      firstName: t.firstName,
      middleName: t.middleName ?? "",
      lastName: t.lastName,
      suffix: t.suffix ?? "",
      contactNumber: t.contactNumber,
      school: t.school,
      companyName: t.company.name,
      requiredHours: t.requiredHours,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    })),
  ));

  zip.file("work_schedule_entries.csv", toCsv(
    ["traineeUserEmail", "dayOfWeek", "startTime", "endTime"],
    workScheduleEntries.map((w) => ({
      traineeUserEmail: w.trainee.user.email,
      dayOfWeek: w.dayOfWeek,
      startTime: w.startTime.toISOString(),
      endTime: w.endTime.toISOString(),
    })),
  ));

  zip.file("supervisors.csv", toCsv(
    [
      "traineeUserEmail",
      "firstName",
      "middleName",
      "lastName",
      "suffix",
      "contactNumber",
      "email",
      "createdAt",
      "updatedAt",
    ],
    supervisors.map((s) => ({
      traineeUserEmail: s.trainee.user.email,
      firstName: s.firstName,
      middleName: s.middleName ?? "",
      lastName: s.lastName,
      suffix: s.suffix ?? "",
      contactNumber: s.contactNumber ?? "",
      email: s.email ?? "",
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    })),
  ));

  zip.file("log_entries.csv", toCsv(
    [
      "traineeUserEmail",
      "date",
      "timeIn",
      "lunchStart",
      "lunchEnd",
      "timeOut",
      "hoursWorked",
      "overtime",
      "offsetUsed",
      "accomplishment",
      "createdAt",
    ],
    logEntries.map((l) => ({
      traineeUserEmail: l.trainee.user.email,
      date: l.date.toISOString(),
      timeIn: l.timeIn.toISOString(),
      lunchStart: l.lunchStart.toISOString(),
      lunchEnd: l.lunchEnd.toISOString(),
      timeOut: l.timeOut?.toISOString() ?? "",
      hoursWorked: l.hoursWorked,
      overtime: l.overtime,
      offsetUsed: l.offsetUsed,
      accomplishment: l.accomplishment ?? "",
      createdAt: l.createdAt.toISOString(),
    })),
  ));

  zip.file("overtime_ledger.csv", toCsv(
    ["traineeUserEmail", "hours", "type", "sourceLogDate", "notes", "createdAt"],
    overtimeLedger.map((o) => ({
      traineeUserEmail: o.trainee.user.email,
      hours: o.hours,
      type: o.type,
      sourceLogDate: o.sourceLog?.date ? dateOnlyKey(o.sourceLog.date) : "",
      notes: o.notes ?? "",
      createdAt: o.createdAt.toISOString(),
    })),
  ));

  zip.file("password_history.csv", toCsv(
    ["userEmail", "passwordHash", "createdAt"],
    passwordHistory.map((p) => ({
      userEmail: p.user.email,
      passwordHash: p.passwordHash,
      createdAt: p.createdAt.toISOString(),
    })),
  ));

  zip.file("password_reset_codes.csv", toCsv(
    ["userEmail", "code", "expiresAt", "used", "createdAt"],
    passwordResetCodes.map((c) => ({
      userEmail: c.user.email,
      code: c.code,
      expiresAt: c.expiresAt.toISOString(),
      used: c.used,
      createdAt: c.createdAt.toISOString(),
    })),
  ));

  zip.file("email_verification_codes.csv", toCsv(
    ["email", "purpose", "userEmail", "code", "expiresAt", "used", "createdAt"],
    emailVerificationCodes.map((c) => ({
      email: c.email,
      purpose: c.purpose,
      userEmail: c.user?.email ?? "",
      code: c.code,
      expiresAt: c.expiresAt.toISOString(),
      used: c.used,
      createdAt: c.createdAt.toISOString(),
    })),
  ));

  zip.file("audit_logs.csv", toCsv(
    ["actionType", "entityName", "recordId", "performedByEmail", "oldValues", "newValues", "metadata", "createdAt"],
    auditLogs.map((a) => ({
      actionType: a.actionType,
      entityName: a.entityName,
      recordId: a.recordId,
      performedByEmail: a.performedBy?.email ?? "",
      oldValues: a.oldValues ? JSON.stringify(a.oldValues) : "",
      newValues: a.newValues ? JSON.stringify(a.newValues) : "",
      metadata: a.metadata ? JSON.stringify(a.metadata) : "",
      createdAt: a.createdAt.toISOString(),
    })),
  ));

  zip.file("system_settings.csv", toCsv(
    ["id", "countEarlyInAsOT", "countLateOutAsOT", "countEarlyLunchEndAsOT"],
    systemSettings.map((s) => ({
      id: s.id,
      countEarlyInAsOT: s.countEarlyInAsOT,
      countLateOutAsOT: s.countLateOutAsOT,
      countEarlyLunchEndAsOT: s.countEarlyLunchEndAsOT,
    })),
  ));

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function readBackupPayload(file: Express.Multer.File): Promise<Record<string, CsvRow[]>> {
  const fileName = file.originalname.toLowerCase();
  const fromZip = fileName.endsWith(".zip") || file.mimetype === "application/zip" || file.mimetype === "application/x-zip-compressed";
  const tables: Record<string, CsvRow[]> = {};

  if (fromZip) {
    const zip = await JSZip.loadAsync(file.buffer);
    const entries = Object.values(zip.files).filter((f) => !f.dir && f.name.toLowerCase().endsWith(".csv"));

    for (const entry of entries) {
      const raw = await entry.async("nodebuffer");
      const key = entry.name.split("/").pop()?.toLowerCase() || "";
      tables[key] = parseCsv(raw);
    }
    return tables;
  }

  if (fileName.endsWith(".csv") || file.mimetype === "text/csv") {
    tables["backup.csv"] = parseCsv(file.buffer);
    return tables;
  }

  throw new Error("Unsupported backup file format. Only .csv and .zip are allowed.");
}

async function importFromTableCsv(tables: Record<string, CsvRow[]>, stats: ImportStats, dryRun: boolean) {
  const usersByEmail = new Map<string, { id: string; role: UserRole }>();
  const companiesByName = new Map<string, string>();
  const traineeIdByEmail = new Map<string, string>();

  const existingUsers = await prisma.user.findMany({ select: { id: true, email: true, role: true } });
  for (const u of existingUsers) usersByEmail.set(normalizeEmail(u.email), { id: u.id, role: u.role });

  const existingCompanies = await prisma.company.findMany({ select: { id: true, name: true } });
  for (const c of existingCompanies) companiesByName.set(normalizeCompanyName(c.name), c.id);

  const existingTrainees = await prisma.userProfile.findMany({ include: { user: { select: { email: true } } } });
  for (const t of existingTrainees) traineeIdByEmail.set(normalizeEmail(t.user.email), t.id);

  const companyRows = tables["companies.csv"] || [];
  for (let i = 0; i < companyRows.length; i += 1) {
    const row = companyRows[i];
    const key = normalizeCompanyName(row.name || "");
    if (!key) {
      stats.companies.failed += 1;
      addFailure(stats, "companies", i + 2, "Missing company name.");
      continue;
    }

    if (companiesByName.has(key)) {
      stats.companies.skipped += 1;
      continue;
    }

    if (!dryRun) {
      const created = await prisma.company.create({ data: { name: key } });
      companiesByName.set(key, created.id);
    }
    stats.companies.imported += 1;
  }

  const userRows = tables["users.csv"] || [];
  for (let i = 0; i < userRows.length; i += 1) {
    const row = userRows[i];
    const email = normalizeEmail(row.email || "");
    if (!email || !row.passwordHash) {
      stats.users.failed += 1;
      addFailure(stats, "users", i + 2, "Missing required fields email/passwordHash.");
      continue;
    }

    if (usersByEmail.has(email)) {
      stats.users.skipped += 1;
      continue;
    }

    const role = (row.role || "TRAINEE").toUpperCase() === "ADMIN" ? UserRole.ADMIN : UserRole.TRAINEE;
    if (!dryRun) {
      const created = await prisma.user.create({
        data: {
          email,
          role,
          passwordHash: row.passwordHash,
          mustChangePassword: toBoolean(row.mustChangePassword),
          failedLoginAttempts: parseIntSafe(row.failedLoginAttempts),
          lockedUntil: parseMaybeDate(row.lockedUntil),
          pendingEmail: row.pendingEmail || null,
          pendingEmailRequestedAt: parseMaybeDate(row.pendingEmailRequestedAt),
          pendingEmailExpiresAt: parseMaybeDate(row.pendingEmailExpiresAt),
          pendingEmailVerifyAttempts: parseIntSafe(row.pendingEmailVerifyAttempts),
          pendingEmailAdminResendRequired: toBoolean(row.pendingEmailAdminResendRequired),
        },
      });
      usersByEmail.set(email, { id: created.id, role: created.role });
    } else {
      usersByEmail.set(email, { id: `dry-user-${i}`, role });
    }

    stats.users.imported += 1;
  }

  const traineeRows = tables["trainees.csv"] || [];
  for (let i = 0; i < traineeRows.length; i += 1) {
    const row = traineeRows[i];
    const userEmail = normalizeEmail(row.userEmail || "");
    const companyKey = normalizeCompanyName(row.companyName || "");
    const existingTraineeId = traineeIdByEmail.get(userEmail);

    if (existingTraineeId) {
      stats.trainees.skipped += 1;
      continue;
    }

    const userRef = usersByEmail.get(userEmail);
    const companyId = companiesByName.get(companyKey);

    if (!userRef || !companyId || !row.firstName || !row.lastName) {
      stats.trainees.failed += 1;
      addFailure(stats, "trainees", i + 2, "Missing related user/company or required fields.");
      continue;
    }

    if (!dryRun) {
      const created = await prisma.userProfile.create({
        data: {
          userId: userRef.id,
          firstName: row.firstName,
          middleName: row.middleName || null,
          lastName: row.lastName,
          suffix: row.suffix || null,
          contactNumber: row.contactNumber || "",
          school: row.school || "",
          companyId,
          requiredHours: parseIntSafe(row.requiredHours),
        },
      });
      traineeIdByEmail.set(userEmail, created.id);
    } else {
      traineeIdByEmail.set(userEmail, `dry-trainee-${i}`);
    }

    stats.trainees.imported += 1;
  }

  const workScheduleRows = tables["work_schedule_entries.csv"] || [];
  for (let i = 0; i < workScheduleRows.length; i += 1) {
    const row = workScheduleRows[i];
    const traineeEmail = normalizeEmail(row.traineeUserEmail || "");
    const traineeId = traineeIdByEmail.get(traineeEmail);
    const dayOfWeek = parseIntSafe(row.dayOfWeek);
    const startTime = parseMaybeDate(row.startTime);
    const endTime = parseMaybeDate(row.endTime);

    if (!traineeId || Number.isNaN(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6 || !startTime || !endTime) {
      stats.workScheduleEntries.failed += 1;
      addFailure(stats, "work_schedule_entries", i + 2, "Invalid trainee/day/time fields.");
      continue;
    }

    if (!dryRun) {
      const existing = await prisma.workScheduleEntry.findUnique({
        where: { traineeId_dayOfWeek: { traineeId, dayOfWeek } },
      });
      if (existing) {
        stats.workScheduleEntries.skipped += 1;
        continue;
      }

      await prisma.workScheduleEntry.create({
        data: { traineeId, dayOfWeek, startTime, endTime },
      });
    }

    stats.workScheduleEntries.imported += 1;
  }

  const supervisorRows = tables["supervisors.csv"] || [];
  for (let i = 0; i < supervisorRows.length; i += 1) {
    const row = supervisorRows[i];
    const traineeEmail = normalizeEmail(row.traineeUserEmail || "");
    const traineeId = traineeIdByEmail.get(traineeEmail);
    const firstName = (row.firstName || "").trim();
    const middleName = (row.middleName || "").trim() || null;
    const lastName = (row.lastName || "").trim();
    const suffix = (row.suffix || "").trim() || null;

    if (!traineeId || !firstName || !lastName) {
      stats.supervisors.failed += 1;
      addFailure(stats, "supervisors", i + 2, "Missing trainee or required name fields.");
      continue;
    }

    if (!dryRun) {
      const existing = await prisma.supervisor.findFirst({
        where: {
          traineeId,
          firstName,
          middleName,
          lastName,
          suffix,
        },
      });

      if (existing) {
        stats.supervisors.skipped += 1;
        continue;
      }

      await prisma.supervisor.create({
        data: {
          traineeId,
          firstName,
          middleName,
          lastName,
          suffix,
          contactNumber: (row.contactNumber || "").trim() || null,
          email: normalizeEmail(row.email || "") || null,
        },
      });
    }

    stats.supervisors.imported += 1;
  }

  const logRows = tables["log_entries.csv"] || [];
  for (let i = 0; i < logRows.length; i += 1) {
    const row = logRows[i];
    const traineeEmail = normalizeEmail(row.traineeUserEmail || "");
    const traineeId = traineeIdByEmail.get(traineeEmail);
    const date = parseMaybeDate(row.date);
    const timeIn = parseMaybeDate(row.timeIn);
    const lunchStart = parseMaybeDate(row.lunchStart);
    const lunchEnd = parseMaybeDate(row.lunchEnd);
    const timeOut = parseMaybeDate(row.timeOut);

    if (!traineeId || !date || !timeIn || !lunchStart || !lunchEnd) {
      stats.logEntries.failed += 1;
      addFailure(stats, "log_entries", i + 2, "Missing trainee or required datetime fields.");
      continue;
    }

    if (!dryRun) {
      const existing = await prisma.logEntry.findUnique({
        where: { traineeId_date: { traineeId, date } },
      });
      if (existing) {
        stats.logEntries.skipped += 1;
        continue;
      }

      await prisma.logEntry.create({
        data: {
          traineeId,
          date,
          timeIn,
          lunchStart,
          lunchEnd,
          timeOut,
          hoursWorked: parseFloatSafe(row.hoursWorked),
          overtime: parseFloatSafe(row.overtime),
          offsetUsed: parseFloatSafe(row.offsetUsed),
          accomplishment: row.accomplishment || null,
        },
      });
    }

    stats.logEntries.imported += 1;
  }

  const overtimeRows = tables["overtime_ledger.csv"] || [];
  for (let i = 0; i < overtimeRows.length; i += 1) {
    const row = overtimeRows[i];
    const traineeEmail = normalizeEmail(row.traineeUserEmail || "");
    const traineeId = traineeIdByEmail.get(traineeEmail);
    const sourceDateRaw = (row.sourceLogDate || "").trim();
    const sourceDate = sourceDateRaw ? new Date(`${sourceDateRaw}T00:00:00.000Z`) : null;
    const type = (row.type || "").toUpperCase() as OvertimeType;

    if (!traineeId || !Object.values(OvertimeType).includes(type)) {
      stats.overtimeLedger.failed += 1;
      addFailure(stats, "overtime_ledger", i + 2, "Missing trainee or invalid overtime type.");
      continue;
    }

    if (!dryRun) {
      let sourceLogId: string | null = null;
      if (sourceDate) {
        const source = await prisma.logEntry.findUnique({ where: { traineeId_date: { traineeId, date: sourceDate } } });
        sourceLogId = source?.id ?? null;
      }

      const duplicate = sourceLogId
        ? await prisma.overtimeLedger.findUnique({ where: { sourceLogId_type: { sourceLogId, type } } })
        : null;

      if (duplicate) {
        stats.overtimeLedger.skipped += 1;
        continue;
      }

      await prisma.overtimeLedger.create({
        data: {
          traineeId,
          hours: parseFloatSafe(row.hours),
          type,
          sourceLogId,
          notes: row.notes || null,
        },
      });
    }

    stats.overtimeLedger.imported += 1;
  }

  const passwordHistoryRows = tables["password_history.csv"] || [];
  for (let i = 0; i < passwordHistoryRows.length; i += 1) {
    const row = passwordHistoryRows[i];
    const userEmail = normalizeEmail(row.userEmail || "");
    const user = usersByEmail.get(userEmail);

    if (!user || !row.passwordHash) {
      stats.passwordHistory.failed += 1;
      addFailure(stats, "password_history", i + 2, "Missing user or passwordHash.");
      continue;
    }

    if (!dryRun) {
      const existing = await prisma.passwordHistory.findFirst({
        where: { userId: user.id, passwordHash: row.passwordHash },
      });
      if (existing) {
        stats.passwordHistory.skipped += 1;
        continue;
      }

      await prisma.passwordHistory.create({
        data: {
          userId: user.id,
          passwordHash: row.passwordHash,
          createdAt: parseMaybeDate(row.createdAt) || new Date(),
        },
      });
    }

    stats.passwordHistory.imported += 1;
  }

  const resetRows = tables["password_reset_codes.csv"] || [];
  for (let i = 0; i < resetRows.length; i += 1) {
    const row = resetRows[i];
    const userEmail = normalizeEmail(row.userEmail || "");
    const user = usersByEmail.get(userEmail);
    const expiresAt = parseMaybeDate(row.expiresAt);

    if (!user || !row.code || !expiresAt) {
      stats.passwordResetCodes.failed += 1;
      addFailure(stats, "password_reset_codes", i + 2, "Missing user/code/expiresAt.");
      continue;
    }

    if (!dryRun) {
      const existing = await prisma.passwordResetCode.findFirst({
        where: { userId: user.id, code: row.code, expiresAt },
      });
      if (existing) {
        stats.passwordResetCodes.skipped += 1;
        continue;
      }

      await prisma.passwordResetCode.create({
        data: {
          userId: user.id,
          code: row.code,
          expiresAt,
          used: toBoolean(row.used),
          createdAt: parseMaybeDate(row.createdAt) || new Date(),
        },
      });
    }

    stats.passwordResetCodes.imported += 1;
  }

  const verificationRows = tables["email_verification_codes.csv"] || [];
  for (let i = 0; i < verificationRows.length; i += 1) {
    const row = verificationRows[i];
    const purposeRaw = (row.purpose || "GENERAL").toUpperCase();
    const purpose = purposeRaw === "EMAIL_UPDATE" ? EmailVerificationPurpose.EMAIL_UPDATE : EmailVerificationPurpose.GENERAL;
    const userEmail = normalizeEmail(row.userEmail || "");
    const user = userEmail ? usersByEmail.get(userEmail) : undefined;
    const expiresAt = parseMaybeDate(row.expiresAt);

    if (!row.email || !row.code || !expiresAt) {
      stats.emailVerificationCodes.failed += 1;
      addFailure(stats, "email_verification_codes", i + 2, "Missing email/code/expiresAt.");
      continue;
    }

    if (!dryRun) {
      const existing = await prisma.emailVerificationCode.findFirst({
        where: {
          email: normalizeEmail(row.email),
          purpose,
          code: row.code,
          expiresAt,
        },
      });

      if (existing) {
        stats.emailVerificationCodes.skipped += 1;
        continue;
      }

      await prisma.emailVerificationCode.create({
        data: {
          email: normalizeEmail(row.email),
          purpose,
          userId: user?.id,
          code: row.code,
          expiresAt,
          used: toBoolean(row.used),
          createdAt: parseMaybeDate(row.createdAt) || new Date(),
        },
      });
    }

    stats.emailVerificationCodes.imported += 1;
  }

  const auditRows = tables["audit_logs.csv"] || [];
  for (let i = 0; i < auditRows.length; i += 1) {
    const row = auditRows[i];
    const actionTypeRaw = (row.actionType || "").toUpperCase();
    const actionType = Object.values(AuditAction).includes(actionTypeRaw as AuditAction)
      ? (actionTypeRaw as AuditAction)
      : null;

    if (!actionType || !row.entityName || !row.recordId) {
      stats.auditLogs.failed += 1;
      addFailure(stats, "audit_logs", i + 2, "Missing actionType/entityName/recordId.");
      continue;
    }

    const performerEmail = normalizeEmail(row.performedByEmail || "");
    const performer = performerEmail ? usersByEmail.get(performerEmail) : undefined;

    if (!dryRun) {
      const createdAt = parseMaybeDate(row.createdAt) || new Date();
      const existing = await prisma.auditLog.findFirst({
        where: {
          actionType,
          entityName: row.entityName,
          recordId: row.recordId,
          createdAt,
        },
      });

      if (existing) {
        stats.auditLogs.skipped += 1;
        continue;
      }

      await prisma.auditLog.create({
        data: {
          actionType,
          entityName: row.entityName,
          recordId: row.recordId,
          performedById: performer?.id,
          oldValues: row.oldValues ? JSON.parse(row.oldValues) : null,
          newValues: row.newValues ? JSON.parse(row.newValues) : null,
          metadata: row.metadata ? JSON.parse(row.metadata) : null,
          createdAt,
        },
      });
    }

    stats.auditLogs.imported += 1;
  }

  const settingsRows = tables["system_settings.csv"] || [];
  for (let i = 0; i < settingsRows.length; i += 1) {
    const row = settingsRows[i];
    const id = (row.id || "default").trim() || "default";

    if (!dryRun) {
      await prisma.systemSettings.upsert({
        where: { id },
        create: {
          id,
          countEarlyInAsOT: toBoolean(row.countEarlyInAsOT),
          countLateOutAsOT: toBoolean(row.countLateOutAsOT),
          countEarlyLunchEndAsOT: toBoolean(row.countEarlyLunchEndAsOT),
        },
        update: {
          countEarlyInAsOT: toBoolean(row.countEarlyInAsOT),
          countLateOutAsOT: toBoolean(row.countLateOutAsOT),
          countEarlyLunchEndAsOT: toBoolean(row.countEarlyLunchEndAsOT),
        },
      });
    }

    stats.systemSettings.imported += 1;
  }
}

async function importLegacyCombinedCsv(tables: Record<string, CsvRow[]>, stats: ImportStats, dryRun: boolean) {
  const rows = tables["backup.csv"] || [];
  if (!rows.length) return;

  const hasRowType = rows.some((r) => Object.prototype.hasOwnProperty.call(r, "RowType"));
  if (!hasRowType) {
    throw new Error("Single CSV import expects a legacy backup file with RowType column.");
  }

  const splitByType: Record<string, CsvRow[]> = {
    "companies.csv": [],
    "users.csv": [],
    "trainees.csv": [],
    "supervisors.csv": [],
    "log_entries.csv": [],
  };

  for (const row of rows) {
    const type = (row.RowType || "").toUpperCase();
    const traineeEmail = row.TraineeEmail || "";

    if (type === "TRAINEE") {
      splitByType["companies.csv"].push({ name: row.CompanyName || "N/A" });
      splitByType["users.csv"].push({
        email: traineeEmail,
        role: "TRAINEE",
        passwordHash: row.PasswordHash || "",
        mustChangePassword: "false",
        failedLoginAttempts: "0",
        pendingEmailVerifyAttempts: "0",
        pendingEmailAdminResendRequired: "false",
      });
      splitByType["trainees.csv"].push({
        userEmail: traineeEmail,
        firstName: row.FirstName || row.First || "",
        middleName: row.MiddleName || row.Middl || row.Middle || "",
        lastName: row.LastName || row.Last || "",
        suffix: row.Suffix || "",
        contactNumber: row.ContactNumber || "",
        school: row.School || "",
        companyName: row.CompanyName || "N/A",
        requiredHours: row.RequiredHours || "0",
      });
    } else if (type === "SUPERVISOR") {
      splitByType["supervisors.csv"].push({
        traineeUserEmail: traineeEmail,
        firstName: row.SupervisorFirstName || row.SupervisorFirst || "",
        middleName: row.SupervisorMiddleName || row.SupervisorMiddle || row.SupervisorMiddl || "",
        lastName: row.SupervisorLastName || row.SupervisorLast || "",
        suffix: row.SupervisorSuffix || "",
        contactNumber: row.SupervisorContact || "",
        email: row.SupervisorEmail || "",
      });
    } else if (type === "LOG") {
      const date = (row.Date || "").trim();
      splitByType["log_entries.csv"].push({
        traineeUserEmail: traineeEmail,
        date: date ? `${date}T00:00:00.000Z` : "",
        timeIn: date && row.TimeIn ? `${date}T${row.TimeIn}:00.000Z` : "",
        lunchStart: date && row.LunchStart ? `${date}T${row.LunchStart}:00.000Z` : "",
        lunchEnd: date && row.LunchEnd ? `${date}T${row.LunchEnd}:00.000Z` : "",
        timeOut: date && row.TimeOut ? `${date}T${row.TimeOut}:00.000Z` : "",
        hoursWorked: row.HoursWorked || "0",
        overtime: row.Overtime || "0",
        offsetUsed: row.OffsetUsed || "0",
        accomplishment: row.Accomplishment || "",
      });
    }
  }

  await importFromTableCsv(splitByType, stats, dryRun);
}

export const verifyBackupSuperPassword = async (req: Request, res: Response) => {
  const { password } = req.body as { password?: string };
  if (!isValidSuperPasswordHash(password)) {
    return res.status(401).json({ error: "Invalid Super Password" });
  }

  return res.json({ message: "Verified" });
};

export const exportBackup = async (req: Request, res: Response) => {
  const providedHash = getHeaderHash(req);
  if (!isValidSuperPasswordHash(providedHash)) {
    return res.status(401).json({ error: "Invalid Super Password" });
  }

  try {
    const zipBuffer = await exportDatabaseAsZip();
    const datePart = format(new Date(), "yyyy-MM-dd");
    const filename = `${datePart}_backup_ojt-tracker.zip`;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
    return res.send(zipBuffer);
  } catch (err) {
    console.error("exportBackup error:", err);
    return res.status(500).json({ error: "Failed to export backup data." });
  }
};

export const importBackup = async (req: Request, res: Response) => {
  const providedHash = getHeaderHash(req);
  if (!isValidSuperPasswordHash(providedHash)) {
    return res.status(401).json({ error: "Invalid Super Password" });
  }

  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: "No file uploaded." });
  }

  const dryRun = toBoolean((req.body?.dryRun as string | undefined) ?? "false");
  const stats = initStats();

  try {
    const tables = await readBackupPayload(file);

    if (tables["backup.csv"]) {
      await importLegacyCombinedCsv(tables, stats, dryRun);
    } else {
      await importFromTableCsv(tables, stats, dryRun);
    }

    updateTotals(stats);

    return res.status(201).json({
      message: dryRun ? "Dry run completed." : "Import completed.",
      dryRun,
      summary: stats.totals,
      byTable: {
        companies: stats.companies,
        users: stats.users,
        trainees: stats.trainees,
        workScheduleEntries: stats.workScheduleEntries,
        supervisors: stats.supervisors,
        logEntries: stats.logEntries,
        overtimeLedger: stats.overtimeLedger,
        passwordHistory: stats.passwordHistory,
        passwordResetCodes: stats.passwordResetCodes,
        emailVerificationCodes: stats.emailVerificationCodes,
        auditLogs: stats.auditLogs,
        systemSettings: stats.systemSettings,
      },
      failures: stats.failures,
      // backward compatibility for existing admin pages using importAllCSV result shape
      trainees: stats.trainees.imported,
      supervisors: stats.supervisors.imported,
      logs: stats.logEntries.imported,
      skipped: stats.totals.skipped,
    });
  } catch (err) {
    console.error("importBackup error:", err);
    return res.status(500).json({ error: err instanceof Error ? err.message : "Failed to import backup." });
  }
};
