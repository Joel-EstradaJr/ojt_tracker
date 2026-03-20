import { Request, Response } from "express";
import { parse } from "csv-parse/sync";
import { differenceInMinutes } from "date-fns";
import prisma from "../utils/prisma";

function normaliseKey(header: string): string {
  return header.trim().toLowerCase().replace(/[\s_]+/g, "");
}

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

function parseDate(val: string): string {
  const v = val.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const slash = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const [, a, b, y] = slash;
    return `${y}-${a.padStart(2, "0")}-${b.padStart(2, "0")}`;
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
      const inDate = parseTime(dateStr, row.timeIn);
      const outDate = parseTime(dateStr, row.timeOut);

      const lStart = row.lunchStart ? parseTime(dateStr, row.lunchStart) : new Date(`${dateStr}T12:00:00`);
      const lEnd = row.lunchEnd ? parseTime(dateStr, row.lunchEnd) : new Date(`${dateStr}T13:00:00`);

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

      const logDate = new Date(dateStr);
      const standardMinutes = getStandardMinutesForDay(trainee.workSchedule, logDate.getDay());
      const overtime = Math.max(0, hoursWorked - standardMinutes);

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

