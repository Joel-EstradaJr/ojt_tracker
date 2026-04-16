import { Request, Response } from "express";
import { parse } from "csv-parse/sync";
import { differenceInMinutes } from "date-fns";
import prisma from "../utils/prisma";

function normaliseKey(header: string): string {
  return header.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const KEY_MAP: Record<string, string> = {
  date: "date",
  dates: "date",
  timein: "timeIn",
  lunchstart: "lunchStart",
  lunchend: "lunchEnd",
  timeout: "timeOut",
  accomplishment: "accomplishment",
  remarks: "accomplishment",
  hoursworked: "_ignore",
  overtime: "_ignore",
  offsetused: "_ignore",
};

function parseTime(dateStr: string, timeVal: string): Date {
  if (!timeVal) return new Date(`${dateStr}T00:00:00`);
  const val = timeVal.trim();

  const directParse = new Date(val);
  if (!isNaN(directParse.getTime()) && val.length > 10) return directParse;

  const match24 = val.match(/^(\d{1,2}):(\d{2})(:\d{2})?$/);
  if (match24) return new Date(`${dateStr}T${val.length === 5 ? val + ":00" : val}`);

  const match12 = val.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (match12) {
    let h = parseInt(match12[1], 10);
    const m = match12[2];
    const ampm = match12[3].toUpperCase();
    if (ampm === "PM" && h < 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    return new Date(`${dateStr}T${String(h).padStart(2, "0")}:${m}:00`);
  }

  return new Date(`${dateStr}T${val}`);
}

function isPlaceholder(value?: string): boolean {
  if (!value) return true;
  const normalized = value.trim().toLowerCase();
  return normalized === "" || normalized === "-" || normalized === "n/a" || normalized === "na" || normalized === "null";
}

function parseTimeOrNull(dateStr: string, timeVal?: string): Date | null {
  if (isPlaceholder(timeVal)) return null;
  const parsed = parseTime(dateStr, String(timeVal));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseDate(val: string): string {
  const v = val.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);

  // Supports frontend display format: "Friday | Mar 20, 2026"
  const display = v.match(/^[A-Za-z]+\s*\|\s*([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})$/);
  if (display) {
    const [, month, day, year] = display;
    const monthMap: Record<string, string> = {
      jan: "01", january: "01",
      feb: "02", february: "02",
      mar: "03", march: "03",
      apr: "04", april: "04",
      may: "05",
      jun: "06", june: "06",
      jul: "07", july: "07",
      aug: "08", august: "08",
      sep: "09", sept: "09", september: "09",
      oct: "10", october: "10",
      nov: "11", november: "11",
      dec: "12", december: "12",
    };

    const monthNum = monthMap[month.toLowerCase()];
    if (monthNum) return `${year}-${monthNum}-${day.padStart(2, "0")}`;
  }

  const slash = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const [, month, day, year] = slash;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const slashShortYear = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (slashShortYear) {
    const [, month, day, yy] = slashShortYear;
    const yearNum = Number(yy);
    const fullYear = yearNum >= 70 ? `19${yy}` : `20${yy}`;
    return `${fullYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const d = new Date(v);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return v;
}

function getStandardMinutesForDay(
  schedule: Array<{ dayOfWeek: number; startTime: Date; endTime: Date }> | null | undefined,
  dayOfWeek: number
): number {
  const entry = (schedule || []).find((s) => s.dayOfWeek === dayOfWeek);
  if (!entry) return 8 * 60;
  const totalMinutes = differenceInMinutes(entry.endTime, entry.startTime);
  const workedMinutes = totalMinutes - 60;
  return workedMinutes > 0 ? workedMinutes : 8 * 60;
}

export const importCSV = async (req: Request, res: Response) => {
  try {
    const { traineeId } = req.params;
    const file = req.file;

    if (!file) return res.status(400).json({ error: "No file uploaded." });

    const trainee = await prisma.userProfile.findUnique({ where: { id: traineeId }, include: { workSchedule: true } });
    if (!trainee) return res.status(404).json({ error: "Trainee not found." });

    const rawRecords: Array<Record<string, string>> = parse(file.buffer.toString(), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    const created = [];
    const skipped: string[] = [];

    for (const raw of rawRecords) {
      const row: Record<string, string> = {};
      for (const [rawKey, val] of Object.entries(raw)) {
        const canonical = KEY_MAP[normaliseKey(rawKey)];
        if (canonical && canonical !== "_ignore") row[canonical] = val;
      }

      if (!row.date || !row.timeIn || !row.timeOut) {
        skipped.push(`Missing required fields in row: ${JSON.stringify(raw)}`);
        continue;
      }

      const dateStr = parseDate(row.date);
      const logDate = new Date(`${dateStr}T00:00:00.000Z`);
      if (Number.isNaN(logDate.getTime())) {
        skipped.push(`Invalid date value '${row.date}'`);
        continue;
      }

      const inDate = parseTimeOrNull(dateStr, row.timeIn);
      const outDate = parseTimeOrNull(dateStr, row.timeOut);
      if (!inDate || !outDate) {
        skipped.push(`Invalid time values for ${dateStr}`);
        continue;
      }

      const parsedLunchStart = parseTimeOrNull(dateStr, row.lunchStart);
      const parsedLunchEnd = parseTimeOrNull(dateStr, row.lunchEnd);

      let lStart: Date;
      let lEnd: Date;

      // Exported placeholder lunch ("-") means no-lunch marker.
      if (!parsedLunchStart && !parsedLunchEnd) {
        lStart = inDate;
        lEnd = inDate;
      } else if (parsedLunchStart && parsedLunchEnd) {
        lStart = parsedLunchStart;
        lEnd = parsedLunchEnd;
      } else {
        skipped.push(`Invalid lunch values for ${dateStr}`);
        continue;
      }

      if (outDate <= inDate) {
        skipped.push(`timeOut <= timeIn for ${dateStr}`);
        continue;
      }

      const hasLunch = lStart.getTime() !== lEnd.getTime();
      if (hasLunch && (lStart <= inDate || lEnd >= outDate || lEnd <= lStart)) {
        skipped.push(`Invalid lunch times for ${dateStr}`);
        continue;
      }

      const totalMinutes = differenceInMinutes(outDate, inDate);
      const lunchMinutes = hasLunch ? differenceInMinutes(lEnd, lStart) : 0;
      const hoursWorked = Math.max(0, totalMinutes - lunchMinutes);
      if (!Number.isFinite(hoursWorked)) {
        skipped.push(`Computed hoursWorked is invalid for ${dateStr}`);
        continue;
      }

      const standardMinutes = getStandardMinutesForDay(trainee.workSchedule, logDate.getDay());
      const overtime = Math.max(0, hoursWorked - standardMinutes);
      if (!Number.isFinite(overtime)) {
        skipped.push(`Computed overtime is invalid for ${dateStr}`);
        continue;
      }

      const existing = await prisma.logEntry.findFirst({ where: { traineeId, date: logDate } });
      if (existing) {
        skipped.push(`Duplicate date ${dateStr} — already has a log entry`);
        continue;
      }

      const log = await prisma.logEntry.create({
        data: {
          traineeId,
          date: logDate,
          timeIn: inDate,
          lunchStart: lStart,
          lunchEnd: lEnd,
          timeOut: outDate,
          hoursWorked,
          overtime,
          accomplishment: row.accomplishment || "",
        },
      });

      if (overtime > 0) {
        await prisma.overtimeLedger.upsert({
          where: { sourceLogId_type: { sourceLogId: log.id, type: "EARNED" } },
          create: { traineeId, sourceLogId: log.id, type: "EARNED", hours: overtime },
          update: { hours: overtime },
        });
      }

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

