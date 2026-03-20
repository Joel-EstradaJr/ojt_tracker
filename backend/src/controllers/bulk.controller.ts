// ============================================================
// Bulk Export / Import Controller
// Exports ALL trainees + supervisors + logs to a single CSV.
// Imports that same CSV to recreate all data.
// ============================================================

import { Request, Response } from "express";
import { parse } from "csv-parse/sync";
import { format } from "date-fns";
import prisma from "../utils/prisma";

// ── Helpers ──────────────────────────────────────────────────

function titleCase(str: string): string {
  return str.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

// ── EXPORT ALL ───────────────────────────────────────────────
// Produces a CSV with every trainee, supervisor, and log entry.
// Row types are distinguished by a "RowType" column:
//   TRAINEE, SUPERVISOR, LOG
//
// This makes it possible to reconstruct the full database from
// a single CSV file.

export const exportAllCSV = async (_req: Request, res: Response) => {
  try {
    const trainees = await prisma.trainee.findMany({
      include: {
        supervisors: true,
        logs: { orderBy: { date: "asc" } },
      },
      orderBy: { createdAt: "asc" },
    });

    const lines: string[] = [];

    // Header
    lines.push([
      "RowType",
      "TraineeEmail",
      "LastName", "FirstName", "MiddleName", "Suffix",
      "ContactNumber", "School", "CompanyName", "RequiredHours", "PasswordHash",
      // Supervisor-specific
      "SupervisorLastName", "SupervisorFirstName", "SupervisorMiddleName", "SupervisorSuffix",
      "SupervisorContact", "SupervisorEmail",
      // Log-specific
      "Date", "TimeIn", "LunchStart", "LunchEnd", "TimeOut",
      "HoursWorked", "Overtime", "OffsetUsed", "Accomplishment",
    ].join(","));

    for (const t of trainees) {
      // TRAINEE row
      lines.push([
        "TRAINEE",
        csvVal(t.email),
        csvVal(t.lastName), csvVal(t.firstName), csvVal(t.middleName ?? ""), csvVal(t.suffix ?? ""),
        csvVal(t.contactNumber), csvVal(t.school), csvVal(t.companyName), String(t.requiredHours), csvVal(t.passwordHash),
        // blank supervisor fields
        "", "", "", "", "", "",
        // blank log fields
        "", "", "", "", "", "", "", "", "",
      ].join(","));

      // SUPERVISOR rows
      for (const s of t.supervisors) {
        lines.push([
          "SUPERVISOR",
          csvVal(t.email), // link to trainee
          "", "", "", "", "", "", "", "", "",
          csvVal(s.lastName), csvVal(s.firstName), csvVal(s.middleName ?? ""), csvVal(s.suffix ?? ""),
          csvVal(s.contactNumber ?? ""), csvVal(s.email ?? ""),
          // blank log fields
          "", "", "", "", "", "", "", "", "",
        ].join(","));
      }

      // LOG rows
      for (const l of t.logs) {
        lines.push([
          "LOG",
          csvVal(t.email), // link to trainee
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

    const csvContent = lines.join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=ojt_tracker_full_backup.csv");
    return res.send(csvContent);
  } catch (err) {
    console.error("exportAllCSV error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

/** Wrap a value in quotes, escaping inner quotes */
function csvVal(v: string): string {
  return `"${v.replace(/"/g, '""')}"`;
}

// ── IMPORT ALL ───────────────────────────────────────────────
// Reads the full-backup CSV and recreates trainees, supervisors,
// and log entries. Skips duplicates (by email for trainees,
// by traineeId+date for logs).

export const importAllCSV = async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    const records: Array<Record<string, string>> = parse(file.buffer.toString(), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    const stats = { trainees: 0, supervisors: 0, logs: 0, skipped: 0 };

    // We'll need to map trainee emails to IDs (newly created or existing)
    const emailToId = new Map<string, string>();

    // Pre-load existing trainees by email
    const existingTrainees = await prisma.trainee.findMany({ select: { id: true, email: true } });
    for (const t of existingTrainees) {
      emailToId.set(t.email.toLowerCase(), t.id);
    }

    for (const row of records) {
      const rowType = (row.RowType || "").trim().toUpperCase();
      const traineeEmail = (row.TraineeEmail || "").trim().toLowerCase();

      if (rowType === "TRAINEE") {
        if (emailToId.has(traineeEmail)) {
          stats.skipped++;
          continue; // trainee already exists
        }

        const trainee = await prisma.trainee.create({
          data: {
            lastName: (row.LastName || "").toUpperCase(),
            firstName: (row.FirstName || "").toUpperCase(),
            middleName: row.MiddleName ? row.MiddleName.toUpperCase() : null,
            suffix: row.Suffix ? row.Suffix.toUpperCase() : null,
            email: row.TraineeEmail || "",
            contactNumber: row.ContactNumber || "",
            school: (row.School || "").toUpperCase(),
            companyName: (row.CompanyName || "").toUpperCase(),
            requiredHours: parseInt(row.RequiredHours || "0", 10),
            passwordHash: row.PasswordHash || "",
          },
        });
        emailToId.set(traineeEmail, trainee.id);
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
        if (!dateStr) { stats.skipped++; continue; }

        // Check for duplicate log on this date
        const existing = await prisma.logEntry.findFirst({
          where: { traineeId, date: new Date(dateStr) },
        });
        if (existing) { stats.skipped++; continue; }

        const timeIn = parseTime(dateStr, row.TimeIn || "08:00");
        const timeOut = parseTime(dateStr, row.TimeOut || "17:00");
        const lunchStart = parseTime(dateStr, row.LunchStart || "12:00");
        const lunchEnd = parseTime(dateStr, row.LunchEnd || "13:00");
        const hoursWorked = parseFloat(row.HoursWorked || "0");
        const overtime = parseFloat(row.Overtime || "0");
        const offsetUsed = parseFloat(row.OffsetUsed || "0");

        await prisma.logEntry.create({
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

/** Parse HH:mm into a Date on the given dateStr */
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
  // HH:mm or full ISO
  if (val.length <= 5) return new Date(`${dateStr}T${val}:00`);
  const d = new Date(val);
  return isNaN(d.getTime()) ? new Date(`${dateStr}T${val}`) : d;
}
