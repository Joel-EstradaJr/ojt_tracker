// ============================================================
// Import Controller
// Parses an uploaded CSV file and inserts log entries into the
// database for a given trainee.
//
// Accepts CSVs exported by this app OR manually created ones.
// Supported column names (case-insensitive, with/without spaces):
//   Date | date
//   Time In | timeIn
//   Lunch Start | lunchStart
//   Lunch End | lunchEnd
//   Time Out | timeOut
//   Accomplishment | accomplishment
//   (Overtime, Offset Used, Hours Worked are ignored on import
//    — they are recalculated automatically)
// ============================================================

import { Request, Response } from "express";
import { parse } from "csv-parse/sync";
import { differenceInMinutes } from "date-fns";
import prisma from "../utils/prisma";

/** Normalise a CSV header to a lowercase, no-space key */
function normaliseKey(header: string): string {
  return header.trim().toLowerCase().replace(/[\s_]+/g, "");
}

/** Map of normalised key → canonical field name */
const KEY_MAP: Record<string, string> = {
  date: "date",
  timein: "timeIn",
  lunchstart: "lunchStart",
  lunchend: "lunchEnd",
  timeout: "timeOut",
  accomplishment: "accomplishment",
  hoursworked: "_ignore",
  overtime: "_ignore",
  offsetused: "_ignore",
};

/** Parse a time value that might be "HH:mm", "HH:mm AM/PM", or a full ISO string */
function parseTime(dateStr: string, timeVal: string): Date {
  if (!timeVal) return new Date(`${dateStr}T00:00:00`);

  const val = timeVal.trim();

  // Already a full ISO / parseable datetime?
  const directParse = new Date(val);
  if (!isNaN(directParse.getTime()) && val.length > 10) {
    return directParse;
  }

  // Handle "HH:mm" or "HH:mm:ss"
  const match24 = val.match(/^(\d{1,2}):(\d{2})(:\d{2})?$/);
  if (match24) {
    return new Date(`${dateStr}T${val.length === 5 ? val + ":00" : val}`);
  }

  // Handle "hh:mm AM/PM"
  const match12 = val.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (match12) {
    let h = parseInt(match12[1], 10);
    const m = match12[2];
    const ampm = match12[3].toUpperCase();
    if (ampm === "PM" && h < 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    return new Date(`${dateStr}T${String(h).padStart(2, "0")}:${m}:00`);
  }

  // Fallback
  return new Date(`${dateStr}T${val}`);
}

/** Parse a date value that might be "yyyy-MM-dd", "MM/dd/yyyy", or ISO */
function parseDate(val: string): string {
  const v = val.trim();
  // Already yyyy-MM-dd?
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  // Try MM/dd/yyyy or dd/MM/yyyy
  const slash = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const [, a, b, y] = slash;
    // Assume MM/dd/yyyy (US / PH format)
    return `${y}-${a.padStart(2, "0")}-${b.padStart(2, "0")}`;
  }
  // Fallback — let JS parse it
  const d = new Date(v);
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return v;
}

// Work schedule type: maps day number (0-6) to {start, end}
type WorkScheduleMap = Record<string, { start: string; end: string }>;

const DEFAULT_SCHEDULE: WorkScheduleMap = {
  "1": { start: "08:00", end: "17:00" },
  "2": { start: "08:00", end: "17:00" },
  "3": { start: "08:00", end: "17:00" },
  "4": { start: "08:00", end: "17:00" },
  "5": { start: "08:00", end: "17:00" },
};

function getStandardMinutesForDay(schedule: WorkScheduleMap | null | undefined, dayOfWeek: number): number {
  const sched = schedule || DEFAULT_SCHEDULE;
  const dayEntry = sched[String(dayOfWeek)];
  if (!dayEntry) return 8 * 60;
  const [sh, sm] = dayEntry.start.split(":").map(Number);
  const [eh, em] = dayEntry.end.split(":").map(Number);
  const totalMinutes = (eh * 60 + em) - (sh * 60 + sm);
  const workedMinutes = totalMinutes - 60;
  return workedMinutes > 0 ? workedMinutes : 8 * 60;
}

export const importCSV = async (req: Request, res: Response) => {
  try {
    const { traineeId } = req.params;

    // multer stores the uploaded file buffer on req.file
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    // Verify trainee exists
    const trainee = await prisma.trainee.findUnique({ where: { id: traineeId } });
    if (!trainee) {
      return res.status(404).json({ error: "Trainee not found." });
    }

    // Parse CSV content with raw headers
    const rawRecords: Array<Record<string, string>> = parse(file.buffer.toString(), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    const created = [];
    const skipped: string[] = [];

    for (const raw of rawRecords) {
      // Map raw headers to canonical field names
      const row: Record<string, string> = {};
      for (const [rawKey, val] of Object.entries(raw)) {
        const canonical = KEY_MAP[normaliseKey(rawKey)];
        if (canonical && canonical !== "_ignore") {
          row[canonical] = val;
        }
      }

      if (!row.date || !row.timeIn || !row.timeOut) {
        skipped.push(`Missing required fields in row: ${JSON.stringify(raw)}`);
        continue;
      }

      const dateStr = parseDate(row.date);
      const inDate = parseTime(dateStr, row.timeIn);
      const outDate = parseTime(dateStr, row.timeOut);

      // Default lunch to 12:00–13:00 on the same date if not provided
      const lStart = row.lunchStart
        ? parseTime(dateStr, row.lunchStart)
        : new Date(`${dateStr}T12:00:00`);
      const lEnd = row.lunchEnd
        ? parseTime(dateStr, row.lunchEnd)
        : new Date(`${dateStr}T13:00:00`);

      // Validate ordering
      if (outDate <= inDate) {
        skipped.push(`timeOut <= timeIn for ${dateStr}`);
        continue;
      }
      // Skip invalid lunch unless no-lunch (lunchStart === lunchEnd)
      const hasLunch = lStart.getTime() !== lEnd.getTime();
      if (hasLunch && (lStart <= inDate || lEnd >= outDate || lEnd <= lStart)) {
        skipped.push(`Invalid lunch times for ${dateStr}`);
        continue;
      }

      const totalMinutes = differenceInMinutes(outDate, inDate);
      const lunchMinutes = hasLunch ? differenceInMinutes(lEnd, lStart) : 0;
      const hoursWorked = Math.max(0, totalMinutes - lunchMinutes);

      if (hoursWorked < 0) {
        skipped.push(`Negative hours for ${dateStr}`);
        continue;
      }

      const logDate = new Date(dateStr);
      const standardMinutes = getStandardMinutesForDay(trainee.workSchedule as WorkScheduleMap, logDate.getDay());
      const overtime = Math.max(0, hoursWorked - standardMinutes);

      // Check for duplicate date
      const existing = await prisma.logEntry.findFirst({
        where: { traineeId, date: new Date(dateStr) },
      });
      if (existing) {
        skipped.push(`Duplicate date ${dateStr} — already has a log entry`);
        continue;
      }

      const log = await prisma.logEntry.create({
        data: {
          traineeId,
          date: new Date(dateStr),
          timeIn: inDate,
          lunchStart: lStart,
          lunchEnd: lEnd,
          timeOut: outDate,
          hoursWorked,
          overtime,
          accomplishment: row.accomplishment || "",
        },
      });

      created.push(log);
    }

    return res.status(201).json({
      imported: created.length,
      skipped: skipped.length,
      skippedDetails: skipped,
      logs: created,
    });
  } catch (err) {
    console.error("importCSV error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};
