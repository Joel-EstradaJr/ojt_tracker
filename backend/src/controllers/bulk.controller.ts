import { Request, Response } from "express";
import { parse } from "csv-parse/sync";
import { format } from "date-fns";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { UserRole } from "@prisma/client";
import prisma from "../utils/prisma";

function csvVal(v: string): string {
  return `"${v.replace(/"/g, '""')}"`;
}

function parseTime(dateStr: string, timeVal: string): Date {
  const val = timeVal.trim();
  const match12 = val.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (match12) {
    let h = parseInt(match12[1], 10);
    const m = match12[2];
    const ampm = match12[3].toUpperCase();
    if (ampm === "PM" && h < 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    return new Date(`${dateStr}T${String(h).padStart(2, "0")}:${m}:00`);
  }
  if (val.length <= 5) return new Date(`${dateStr}T${val}:00`);
  const d = new Date(val);
  return isNaN(d.getTime()) ? new Date(`${dateStr}T${val}`) : d;
}

export const exportAllCSV = async (_req: Request, res: Response) => {
  try {
    const trainees = await prisma.userProfile.findMany({
      include: {
        user: true,
        company: true,
        supervisors: true,
        logs: { orderBy: { date: "asc" } },
      },
      orderBy: { createdAt: "asc" },
    });

    const lines: string[] = [];
    lines.push([
      "RowType",
      "TraineeEmail",
      "LastName", "FirstName", "MiddleName", "Suffix",
      "ContactNumber", "School", "CompanyName", "RequiredHours", "PasswordHash",
      "SupervisorLastName", "SupervisorFirstName", "SupervisorMiddleName", "SupervisorSuffix",
      "SupervisorContact", "SupervisorEmail",
      "Date", "TimeIn", "LunchStart", "LunchEnd", "TimeOut",
      "HoursWorked", "Overtime", "OffsetUsed", "Accomplishment",
    ].join(","));

    for (const t of trainees) {
      lines.push([
        "TRAINEE",
        csvVal(t.user.email),
        csvVal(t.lastName), csvVal(t.firstName), csvVal(t.middleName ?? ""), csvVal(t.suffix ?? ""),
        csvVal(t.contactNumber), csvVal(t.school), csvVal(t.company?.name ?? ""), String(t.requiredHours), csvVal(t.user.passwordHash),
        "", "", "", "", "", "",
        "", "", "", "", "", "", "", "", "",
      ].join(","));

      for (const s of t.supervisors) {
        lines.push([
          "SUPERVISOR",
          csvVal(t.user.email),
          "", "", "", "", "", "", "", "", "",
          csvVal(s.lastName), csvVal(s.firstName), csvVal(s.middleName ?? ""), csvVal(s.suffix ?? ""),
          csvVal(s.contactNumber ?? ""), csvVal(s.email ?? ""),
          "", "", "", "", "", "", "", "", "",
        ].join(","));
      }

      for (const l of t.logs) {
        lines.push([
          "LOG",
          csvVal(t.user.email),
          "", "", "", "", "", "", "", "", "",
          "", "", "", "", "", "",
          format(l.date, "yyyy-MM-dd"),
          format(l.timeIn, "HH:mm"),
          format(l.lunchStart, "HH:mm"),
          format(l.lunchEnd, "HH:mm"),
          l.timeOut ? format(l.timeOut, "HH:mm") : "N/A",
          String(l.hoursWorked),
          String(l.overtime),
          String(l.offsetUsed),
          csvVal(l.accomplishment ?? ""),
        ].join(","));
      }
    }

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=ojt_tracker_full_backup.csv");
    return res.send(lines.join("\n"));
  } catch (err) {
    console.error("exportAllCSV error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

export const importAllCSV = async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file uploaded." });

    const records: Array<Record<string, string>> = parse(file.buffer.toString(), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    const stats = { trainees: 0, supervisors: 0, logs: 0, skipped: 0 };
    const emailToId = new Map<string, string>();

    const existingTrainees = await prisma.userProfile.findMany({ include: { user: { select: { email: true } } } });
    for (const t of existingTrainees) {
      emailToId.set(t.user.email.toLowerCase(), t.id);
    }

    const fallbackHash = await bcrypt.hash(crypto.createHash("sha256").update("changeme").digest("hex"), 10);

    for (const row of records) {
      const rowType = (row.RowType || "").trim().toUpperCase();
      const traineeEmail = (row.TraineeEmail || "").trim().toLowerCase();

      if (rowType === "TRAINEE") {
        if (emailToId.has(traineeEmail)) {
          stats.skipped++;
          continue;
        }

        const company = await prisma.company.upsert({
          where: { name: (row.CompanyName || "N/A").toUpperCase() },
          update: {},
          create: { name: (row.CompanyName || "N/A").toUpperCase() },
        });

        const created = await prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              email: row.TraineeEmail || "",
              role: UserRole.TRAINEE,
              passwordHash: row.PasswordHash || fallbackHash,
            },
          });

          return tx.userProfile.create({
            data: {
              userId: user.id,
              lastName: (row.LastName || "").toUpperCase(),
              firstName: (row.FirstName || "").toUpperCase(),
              middleName: row.MiddleName ? row.MiddleName.toUpperCase() : null,
              suffix: row.Suffix ? row.Suffix.toUpperCase() : null,
              contactNumber: row.ContactNumber || "",
              school: (row.School || "").toUpperCase(),
              companyId: company.id,
              requiredHours: parseInt(row.RequiredHours || "0", 10),
            },
          });
        });

        emailToId.set(traineeEmail, created.id);
        stats.trainees++;
      } else if (rowType === "SUPERVISOR") {
        const traineeId = emailToId.get(traineeEmail);
        if (!traineeId) {
          stats.skipped++;
          continue;
        }

        await prisma.supervisor.create({
          data: {
            traineeId,
            lastName: (row.SupervisorLastName || "").toUpperCase(),
            firstName: (row.SupervisorFirstName || "").toUpperCase(),
            middleName: row.SupervisorMiddleName ? row.SupervisorMiddleName.toUpperCase() : null,
            suffix: row.SupervisorSuffix ? row.SupervisorSuffix.toUpperCase() : null,
            contactNumber: row.SupervisorContact || null,
            email: row.SupervisorEmail || null,
          },
        });
        stats.supervisors++;
      } else if (rowType === "LOG") {
        const traineeId = emailToId.get(traineeEmail);
        if (!traineeId) {
          stats.skipped++;
          continue;
        }

        const dateStr = (row.Date || "").trim();
        if (!dateStr) {
          stats.skipped++;
          continue;
        }

        const existing = await prisma.logEntry.findFirst({
          where: { traineeId, date: new Date(dateStr) },
        });
        if (existing) {
          stats.skipped++;
          continue;
        }

        const timeIn = parseTime(dateStr, row.TimeIn || "08:00");
        const timeOut = parseTime(dateStr, row.TimeOut || "17:00");
        const lunchStart = parseTime(dateStr, row.LunchStart || "12:00");
        const lunchEnd = parseTime(dateStr, row.LunchEnd || "13:00");
        const hoursWorked = parseFloat(row.HoursWorked || "0");
        const overtime = parseFloat(row.Overtime || "0");
        const offsetUsed = parseFloat(row.OffsetUsed || "0");

        const log = await prisma.logEntry.create({
          data: {
            traineeId,
            date: new Date(dateStr),
            timeIn,
            lunchStart,
            lunchEnd,
            timeOut,
            hoursWorked: isNaN(hoursWorked) ? 0 : hoursWorked,
            overtime: isNaN(overtime) ? 0 : overtime,
            offsetUsed: isNaN(offsetUsed) ? 0 : offsetUsed,
            accomplishment: row.Accomplishment || "",
          },
        });

        if (log.overtime > 0) {
          await prisma.overtimeLedger.upsert({
            where: { sourceLogId_type: { sourceLogId: log.id, type: "EARNED" } },
            create: { traineeId, sourceLogId: log.id, type: "EARNED", hours: log.overtime },
            update: { hours: log.overtime },
          });
        }
        if (log.offsetUsed > 0) {
          await prisma.overtimeLedger.upsert({
            where: { sourceLogId_type: { sourceLogId: log.id, type: "USED" } },
            create: { traineeId, sourceLogId: log.id, type: "USED", hours: log.offsetUsed },
            update: { hours: log.offsetUsed },
          });
        }

        stats.logs++;
      } else {
        stats.skipped++;
      }
    }

    return res.status(201).json(stats);
  } catch (err) {
    console.error("importAllCSV error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

