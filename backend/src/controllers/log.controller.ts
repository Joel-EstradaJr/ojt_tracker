// ============================================================
// Log Entry Controller
// Handles CRUD operations for trainee time-log entries.
// Includes per-source overtime calculation using admin toggles.
//
// ── Overtime Sources (each with admin toggle) ────────────────
// • Early Time In  = max(0, scheduledStart − timeIn)
// • Late Time Out  = max(0, timeOut − scheduledEnd)
// • Early Lunch End= max(0, 60min − actualLunchMinutes)
//
// ── Lunch Rules ──────────────────────────────────────────────
// • Standard lunch = 60 minutes
// • Lunch > 60 min → excess NOT counted as work hours
// • Lunch < 60 min → remainder is overtime (if toggle on)
//
// ── Offset Rules ─────────────────────────────────────────────
// • "Offset bank" = cumulative overtime − cumulative offset used
// • Client may request applyOffset + offsetAmount, capped at bank
// ============================================================

import { Request, Response } from "express";
import { differenceInMinutes } from "date-fns";
import prisma from "../utils/prisma";

const DEFAULT_STANDARD_HOURS = 8;
const STANDARD_LUNCH_MINUTES = 60;

// Work schedule type: maps day number (0-6) to {start, end}
type WorkScheduleMap = Record<string, { start: string; end: string }>;

const DEFAULT_SCHEDULE: WorkScheduleMap = {
  "1": { start: "08:00", end: "17:00" },
  "2": { start: "08:00", end: "17:00" },
  "3": { start: "08:00", end: "17:00" },
  "4": { start: "08:00", end: "17:00" },
  "5": { start: "08:00", end: "17:00" },
};

// ── Helper: get schedule entry for a specific day ────────────
function getScheduleForDay(schedule: WorkScheduleMap | null | undefined, dayOfWeek: number) {
  const sched = schedule || DEFAULT_SCHEDULE;
  return sched[String(dayOfWeek)] || null;
}

// ── Helper: compute standard hours for a specific day ────────
function getStandardHoursForDay(schedule: WorkScheduleMap | null | undefined, dayOfWeek: number): number {
  const dayEntry = getScheduleForDay(schedule, dayOfWeek);
  if (!dayEntry) return DEFAULT_STANDARD_HOURS;
  const [sh, sm] = dayEntry.start.split(":").map(Number);
  const [eh, em] = dayEntry.end.split(":").map(Number);
  const totalMinutes = (eh * 60 + em) - (sh * 60 + sm);
  const workedMinutes = totalMinutes - STANDARD_LUNCH_MINUTES;
  return workedMinutes > 0 ? parseFloat((workedMinutes / 60).toFixed(2)) : DEFAULT_STANDARD_HOURS;
}

// ── Helper: parse "HH:mm" string to minutes since midnight ───
function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

// ── Helper: compute hoursWorked with lunch cap ───────────────
// If lunch > 60 min, excess is NOT counted as work hours.
// Effective lunch = max(actualLunch, 60min) for deduction.
function calcHoursWorked(timeIn: Date, timeOut: Date, lunchStart: Date, lunchEnd: Date): number {
  const totalMinutes = differenceInMinutes(timeOut, timeIn);
  const actualLunchMinutes = differenceInMinutes(lunchEnd, lunchStart);
  // If no lunch (lunchStart === lunchEnd), don't deduct
  const hasLunch = actualLunchMinutes > 0;
  // Cap: deduct at least 60 min if they took lunch, or the actual if longer
  const lunchDeduction = hasLunch ? Math.max(actualLunchMinutes, STANDARD_LUNCH_MINUTES) : 0;
  const workedMinutes = totalMinutes - lunchDeduction;
  return parseFloat((workedMinutes / 60).toFixed(2));
}

// ── Settings cache (avoid repeated DB calls within same request) ──
interface OvertimeSettings {
  countEarlyInAsOT: boolean;
  countLateOutAsOT: boolean;
  countEarlyLunchEndAsOT: boolean;
}

async function getOvertimeSettings(): Promise<OvertimeSettings> {
  const settings = await prisma.systemSettings.findUnique({ where: { id: "default" } });
  return {
    countEarlyInAsOT: settings?.countEarlyInAsOT ?? false,
    countLateOutAsOT: settings?.countLateOutAsOT ?? false,
    countEarlyLunchEndAsOT: settings?.countEarlyLunchEndAsOT ?? false,
  };
}

// ── Core: calculate per-source overtime ──────────────────────
function calculateOvertime(
  timeIn: Date,
  timeOut: Date,
  lunchStart: Date,
  lunchEnd: Date,
  scheduleEntry: { start: string; end: string } | null,
  settings: OvertimeSettings,
): number {
  if (!scheduleEntry) return 0; // non-work day → no overtime

  const scheduledStartMin = timeToMinutes(scheduleEntry.start);
  const scheduledEndMin = timeToMinutes(scheduleEntry.end);

  const actualInMin = timeIn.getHours() * 60 + timeIn.getMinutes();
  const actualOutMin = timeOut.getHours() * 60 + timeOut.getMinutes();

  let totalOT = 0;

  // Early Time In overtime
  if (settings.countEarlyInAsOT && actualInMin < scheduledStartMin) {
    totalOT += (scheduledStartMin - actualInMin) / 60;
  }

  // Late Time Out overtime
  if (settings.countLateOutAsOT && actualOutMin > scheduledEndMin) {
    totalOT += (actualOutMin - scheduledEndMin) / 60;
  }

  // Early Lunch End overtime (lunch < 60 min)
  if (settings.countEarlyLunchEndAsOT) {
    const actualLunchMinutes = differenceInMinutes(lunchEnd, lunchStart);
    if (actualLunchMinutes > 0 && actualLunchMinutes < STANDARD_LUNCH_MINUTES) {
      totalOT += (STANDARD_LUNCH_MINUTES - actualLunchMinutes) / 60;
    }
  }

  return parseFloat(Math.max(0, totalOT).toFixed(2));
}

// ── Helper: calculate a trainee's available offset bank ──────
// Available = sum(overtime) − sum(offsetUsed) across ALL logs,
// optionally excluding a specific log id (for update scenarios).
async function getAvailableOffset(traineeId: string, excludeLogId?: string): Promise<number> {
  const logs = await prisma.logEntry.findMany({
    where: {
      traineeId,
      ...(excludeLogId ? { id: { not: excludeLogId } } : {}),
    },
    select: { overtime: true, offsetUsed: true },
  });
  const totalOT = logs.reduce((s, l) => s + l.overtime, 0);
  const totalUsed = logs.reduce((s, l) => s + l.offsetUsed, 0);
  return parseFloat(Math.max(0, totalOT - totalUsed).toFixed(2));
}

// ── Create a new log entry ───────────────────────────────────
// Supports both full creation (admin) and partial (trainee: Time In only)
export const createLog = async (req: Request, res: Response) => {
  try {
    const {
      traineeId, date, timeIn, timeOut, lunchStart, lunchEnd,
      accomplishment, applyOffset, offsetAmount,
    } = req.body;

    const logDate = new Date(date);
    const inDate = new Date(timeIn);

    // Duplicate-date guard
    const duplicate = await prisma.logEntry.findUnique({
      where: { traineeId_date: { traineeId, date: logDate } },
    });
    if (duplicate) {
      return res.status(409).json({ error: "A log entry already exists for this date." });
    }

    // Partial log (trainee button flow): only timeIn, no timeOut yet
    if (!timeOut) {
      const log = await prisma.logEntry.create({
        data: {
          traineeId,
          date: logDate,
          timeIn: inDate,
          lunchStart: inDate, // placeholder
          lunchEnd: inDate,   // placeholder
          hoursWorked: 0,
          overtime: 0,
          offsetUsed: 0,
          accomplishment: accomplishment || null,
        },
      });
      return res.status(201).json(log);
    }

    // Full log (admin form): all fields present
    const outDate = new Date(timeOut);
    const lStart = lunchStart ? new Date(lunchStart) : inDate;
    const lEnd = lunchEnd ? new Date(lunchEnd) : inDate;

    // Fetch trainee's work schedule for overtime calculation
    const trainee = await prisma.trainee.findUnique({
      where: { id: traineeId },
      select: { workSchedule: true },
    });
    const standardHours = getStandardHoursForDay(
      trainee?.workSchedule as WorkScheduleMap | null,
      logDate.getDay(),
    );

    const hoursWorked = calcHoursWorked(inDate, outDate, lStart, lEnd);
    const overtime = parseFloat(Math.max(0, hoursWorked - standardHours).toFixed(2));

    let offsetUsed = 0;
    if (applyOffset) {
      const available = await getAvailableOffset(traineeId);
      const requested = typeof offsetAmount === "number" && offsetAmount > 0 ? offsetAmount : available;
      offsetUsed = parseFloat(Math.min(requested, available).toFixed(2));
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
        offsetUsed,
        accomplishment: accomplishment || null,
      },
    });

    return res.status(201).json(log);
  } catch (err) {
    console.error("createLog error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

// ── Get all logs for a trainee ───────────────────────────────
export const getLogsByTrainee = async (req: Request, res: Response) => {
  try {
    const { traineeId } = req.params;

    const logs = await prisma.logEntry.findMany({
      where: { traineeId },
      orderBy: { date: "desc" },
    });

    const totalHours = logs.reduce((sum, l) => sum + l.hoursWorked, 0);
    const totalOvertime = logs.reduce((sum, l) => sum + l.overtime, 0);
    const totalOffsetUsed = logs.reduce((sum, l) => sum + l.offsetUsed, 0);
    const availableOffset = parseFloat(Math.max(0, totalOvertime - totalOffsetUsed).toFixed(2));

    return res.json({
      logs,
      totalHours: parseFloat(totalHours.toFixed(2)),
      totalOvertime: parseFloat(totalOvertime.toFixed(2)),
      totalOffsetUsed: parseFloat(totalOffsetUsed.toFixed(2)),
      availableOffset,
    });
  } catch (err) {
    console.error("getLogsByTrainee error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

// ── Update a log entry ───────────────────────────────────────
export const updateLog = async (req: Request, res: Response) => {
  try {
    const { entryId: id } = req.params;
    const {
      date, timeIn, timeOut, lunchStart, lunchEnd,
      accomplishment, applyOffset, offsetAmount,
    } = req.body;

    const existing = await prisma.logEntry.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: "Log entry not found." });
    }

    const newDate = date ? new Date(date) : existing.date;
    const inDate = timeIn ? new Date(timeIn) : existing.timeIn;
    const outDate = timeOut ? new Date(timeOut) : existing.timeOut;
    const lStart = lunchStart ? new Date(lunchStart) : existing.lunchStart;
    const lEnd = lunchEnd ? new Date(lunchEnd) : existing.lunchEnd;

    // Duplicate-date guard (exclude self)
    const duplicate = await prisma.logEntry.findFirst({
      where: { traineeId: existing.traineeId, date: newDate, id: { not: id } },
    });
    if (duplicate) {
      return res.status(409).json({ error: "A log entry already exists for this date." });
    }

    // Validate time ordering and compute hours only if timeOut is set
    let hoursWorked = existing.hoursWorked;
    let overtime = existing.overtime;

    if (outDate) {
      if (outDate <= inDate) return res.status(400).json({ error: "timeOut must be after timeIn." });
      const hasLunch = lStart.getTime() !== lEnd.getTime();
      if (hasLunch) {
        if (lStart <= inDate) return res.status(400).json({ error: "lunchStart must be after timeIn." });
        if (lEnd >= outDate) return res.status(400).json({ error: "lunchEnd must be before timeOut." });
        if (lEnd <= lStart) return res.status(400).json({ error: "lunchEnd must be after lunchStart." });
      }

      hoursWorked = calcHoursWorked(inDate, outDate, lStart, lEnd);
      if (hoursWorked < 0) return res.status(400).json({ error: "hoursWorked cannot be negative." });

      // Fetch trainee's work schedule for overtime calculation
      const trainee = await prisma.trainee.findUnique({
        where: { id: existing.traineeId },
        select: { workSchedule: true },
      });
      const standardHours = getStandardHoursForDay(
        trainee?.workSchedule as WorkScheduleMap | null,
        newDate.getDay(),
      );
      overtime = parseFloat(Math.max(0, hoursWorked - standardHours).toFixed(2));
    }

    // Offset: recalculate available bank excluding this log, then apply if requested
    let offsetUsed = 0;
    if (applyOffset) {
      const available = await getAvailableOffset(existing.traineeId, id);
      const requested = typeof offsetAmount === "number" && offsetAmount > 0 ? offsetAmount : available;
      offsetUsed = parseFloat(Math.min(requested, available).toFixed(2));
    }

    const log = await prisma.logEntry.update({
      where: { id },
      data: {
        date: newDate,
        timeIn: inDate,
        lunchStart: lStart,
        lunchEnd: lEnd,
        timeOut: outDate,
        hoursWorked,
        overtime,
        offsetUsed,
        accomplishment: accomplishment !== undefined ? accomplishment : undefined,
      },
    });

    return res.json(log);
  } catch (err) {
    console.error("updateLog error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

// ── Delete a log entry ────────────────────────────────────────
export const deleteLog = async (req: Request, res: Response) => {
  try {
    const { entryId: id } = req.params;
    await prisma.logEntry.delete({ where: { id } });
    // No extra recalculation needed — the deleted row's overtime
    // and offsetUsed are simply removed from the running totals.
    return res.json({ message: "Log entry deleted." });
  } catch (err) {
    console.error("deleteLog error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

// ── Get available offset for a trainee ───────────────────────
export const getOffset = async (req: Request, res: Response) => {
  try {
    const { traineeId } = req.params;
    const available = await getAvailableOffset(traineeId);
    return res.json({ availableOffset: available });
  } catch (err) {
    console.error("getOffset error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

// ── Patch log action (sequential button flow) ────────────────
// Trainee calls this to set lunchStart, lunchEnd, timeOut, accomplishment
// one step at a time.
export const patchLogAction = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { action, timestamp, accomplishment } = req.body;

    const log = await prisma.logEntry.findUnique({ where: { id } });
    if (!log) return res.status(404).json({ error: "Log entry not found." });

    const ts = timestamp ? new Date(timestamp) : new Date();
    const data: Record<string, unknown> = {};

    switch (action) {
      case "lunchStart":
        if (log.lunchStart.getTime() !== log.timeIn.getTime()) {
          return res.status(400).json({ error: "Lunch Start already recorded." });
        }
        data.lunchStart = ts;
        break;

      case "lunchEnd":
        if (log.lunchStart.getTime() === log.timeIn.getTime()) {
          return res.status(400).json({ error: "Cannot end lunch without starting it." });
        }
        data.lunchEnd = ts;
        break;

      case "timeOut": {
        const lStart = log.lunchStart;
        const lEnd = (data.lunchEnd as Date) || log.lunchEnd;
        const hoursWorked = calcHoursWorked(log.timeIn, ts, lStart, lEnd);

        const trainee = await prisma.trainee.findUnique({
          where: { id: log.traineeId },
          select: { workSchedule: true },
        });
        const standardHours = getStandardHoursForDay(
          trainee?.workSchedule as WorkScheduleMap | null,
          log.date.getDay(),
        );

        data.timeOut = ts;
        data.hoursWorked = hoursWorked;
        data.overtime = parseFloat(Math.max(0, hoursWorked - standardHours).toFixed(2));
        break;
      }

      case "accomplishment":
        if (!accomplishment) return res.status(400).json({ error: "Accomplishment text required." });
        data.accomplishment = accomplishment;
        break;

      default:
        return res.status(400).json({ error: `Invalid action: ${action}` });
    }

    const updated = await prisma.logEntry.update({ where: { id }, data });
    return res.json(updated);
  } catch (err) {
    console.error("patchLogAction error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};
