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

const DEFAULT_STANDARD_MINUTES = 8 * 60;
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
function getStandardMinutesForDay(schedule: WorkScheduleMap | null | undefined, dayOfWeek: number): number {
  const dayEntry = getScheduleForDay(schedule, dayOfWeek);
  if (!dayEntry) return DEFAULT_STANDARD_MINUTES;
  const [sh, sm] = dayEntry.start.split(":").map(Number);
  const [eh, em] = dayEntry.end.split(":").map(Number);
  const totalMinutes = (eh * 60 + em) - (sh * 60 + sm);
  const workedMinutes = totalMinutes - STANDARD_LUNCH_MINUTES;
  return workedMinutes > 0 ? workedMinutes : DEFAULT_STANDARD_MINUTES;
}

// ── Helper: parse "HH:mm" string to minutes since midnight ───
function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

// ── Helper: compute hoursWorked with lunch cap ───────────────
// If lunch > 60 min, excess is NOT counted as work hours.
// Effective lunch = max(actualLunch, 60min) for deduction.
function calcWorkedMinutes(timeIn: Date, timeOut: Date, lunchStart: Date, lunchEnd: Date): number {
  const totalMinutes = differenceInMinutes(timeOut, timeIn);
  const actualLunchMinutes = differenceInMinutes(lunchEnd, lunchStart);
  const hasLunch = actualLunchMinutes > 0;
  const lunchDeduction = hasLunch ? Math.max(actualLunchMinutes, STANDARD_LUNCH_MINUTES) : 0;
  return Math.max(0, totalMinutes - lunchDeduction);
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

  let totalOTMinutes = 0;

  // Early Time In overtime
  if (settings.countEarlyInAsOT && actualInMin < scheduledStartMin) {
    totalOTMinutes += scheduledStartMin - actualInMin;
  }

  // Late Time Out overtime
  if (settings.countLateOutAsOT && actualOutMin > scheduledEndMin) {
    totalOTMinutes += actualOutMin - scheduledEndMin;
  }

  // Early Lunch End overtime (lunch < 60 min)
  if (settings.countEarlyLunchEndAsOT) {
    const actualLunchMinutes = differenceInMinutes(lunchEnd, lunchStart);
    if (actualLunchMinutes > 0 && actualLunchMinutes < STANDARD_LUNCH_MINUTES) {
      totalOTMinutes += STANDARD_LUNCH_MINUTES - actualLunchMinutes;
    }
  }

  return Math.max(0, Math.floor(totalOTMinutes));
}

// ── Helper: calculate a trainee's available offset bank ──────
// Available = sum(overtime) − sum(offsetUsed) across ALL logs,
// optionally excluding a specific log id (for update scenarios).
async function getAvailableOffsetMinutes(traineeId: string, excludeLogId?: string): Promise<number> {
  const logs = await prisma.logEntry.findMany({
    where: {
      traineeId,
      ...(excludeLogId ? { id: { not: excludeLogId } } : {}),
    },
    select: { overtime: true, offsetUsed: true },
  });
  const totalOT = logs.reduce((s, l) => s + l.overtime, 0);
  const totalUsed = logs.reduce((s, l) => s + l.offsetUsed, 0);
  return Math.max(0, Math.floor(totalOT - totalUsed));
}

// ── Create a new log entry ───────────────────────────────────
// Supports both full creation (admin) and partial (trainee: Time In only)
export const createLog = async (req: Request, res: Response) => {
  try {
    const auth = (req as Request & { auth?: { role: "admin" | "trainee"; traineeId?: string } }).auth;
    const {
      traineeId, date, timeIn, timeOut, lunchStart, lunchEnd,
      accomplishment, applyOffset, offsetAmount,
    } = req.body;

    if (auth?.role === "trainee" && auth.traineeId !== traineeId) {
      return res.status(403).json({ error: "Access denied." });
    }

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
    const standardMinutes = getStandardMinutesForDay(
      trainee?.workSchedule as WorkScheduleMap | null,
      logDate.getDay(),
    );

    let hoursWorked = calcWorkedMinutes(inDate, outDate, lStart, lEnd);
    const overtime = Math.max(0, hoursWorked - standardMinutes);

    let offsetUsed = 0;
    if (applyOffset) {
      const available = await getAvailableOffsetMinutes(traineeId);
      const requested = typeof offsetAmount === "number" && offsetAmount > 0 ? offsetAmount : available;
      offsetUsed = Math.max(0, Math.min(Math.floor(requested), available));
      hoursWorked += offsetUsed;
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
    const availableOffset = Math.max(0, Math.floor(totalOvertime - totalOffsetUsed));

    return res.json({
      logs,
      totalHours,
      totalOvertime,
      totalOffsetUsed,
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
    const auth = (req as Request & { auth?: { role: "admin" | "trainee"; traineeId?: string } }).auth;
    const { entryId: id } = req.params;
    const {
      date, timeIn, timeOut, lunchStart, lunchEnd,
      accomplishment, applyOffset, offsetAmount,
    } = req.body;

    const existing = await prisma.logEntry.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: "Log entry not found." });
    }
    if (auth?.role === "trainee" && auth.traineeId !== existing.traineeId) {
      return res.status(403).json({ error: "Access denied." });
    }

    if (auth?.role === "trainee") {
      const hasLockedFieldUpdate = [date, timeIn, timeOut, lunchStart, lunchEnd].some((v) => v !== undefined);
      if (hasLockedFieldUpdate) {
        return res.status(400).json({
          error: "Only accomplishment and offset fields can be edited from trainee entry logs.",
        });
      }
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

      hoursWorked = calcWorkedMinutes(inDate, outDate, lStart, lEnd);
      if (hoursWorked < 0) return res.status(400).json({ error: "hoursWorked cannot be negative." });

      // Fetch trainee's work schedule for overtime calculation
      const trainee = await prisma.trainee.findUnique({
        where: { id: existing.traineeId },
        select: { workSchedule: true },
      });
      const standardMinutes = getStandardMinutesForDay(
        trainee?.workSchedule as WorkScheduleMap | null,
        newDate.getDay(),
      );
      overtime = Math.max(0, hoursWorked - standardMinutes);
    }

    // Offset: recalculate available bank excluding this log, then apply if requested
    let offsetUsed = 0;
    if (applyOffset) {
      const available = await getAvailableOffsetMinutes(existing.traineeId, id);
      const requested = typeof offsetAmount === "number" && offsetAmount > 0 ? offsetAmount : available;
      offsetUsed = Math.max(0, Math.min(Math.floor(requested), available));
      hoursWorked += offsetUsed;
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
    const auth = (req as Request & { auth?: { role: "admin" | "trainee"; traineeId?: string } }).auth;
    const { entryId: id } = req.params;
    if (auth?.role === "trainee") {
      const existing = await prisma.logEntry.findUnique({ where: { id }, select: { traineeId: true } });
      if (!existing) return res.status(404).json({ error: "Log entry not found." });
      if (auth.traineeId !== existing.traineeId) {
        return res.status(403).json({ error: "Access denied." });
      }
    }
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
    const available = await getAvailableOffsetMinutes(traineeId);
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
    const auth = (req as Request & { auth?: { role: "admin" | "trainee"; traineeId?: string } }).auth;
    const { id } = req.params;
    const { action, timestamp, accomplishment, offsetMinutes } = req.body;

    const log = await prisma.logEntry.findUnique({ where: { id } });
    if (!log) return res.status(404).json({ error: "Log entry not found." });
    if (auth?.role === "trainee" && auth.traineeId !== log.traineeId) {
      return res.status(403).json({ error: "Access denied." });
    }

    const ts = timestamp ? new Date(timestamp) : new Date();
    const data: Record<string, unknown> = {};

    switch (action) {
      case "lunchStart":
        if (log.timeOut) {
          return res.status(400).json({ error: "Cannot start lunch after Time Out." });
        }
        if (log.lunchStart.getTime() !== log.timeIn.getTime()) {
          return res.status(400).json({ error: "Lunch Start already recorded." });
        }
        data.lunchStart = ts;
        break;

      case "lunchEnd":
        if (log.timeOut) {
          return res.status(400).json({ error: "Cannot end lunch after Time Out." });
        }
        if (log.lunchStart.getTime() === log.timeIn.getTime()) {
          return res.status(400).json({ error: "Cannot end lunch without starting it." });
        }
        data.lunchEnd = ts;
        break;

      case "timeOut": {
        if (log.timeOut) {
          return res.status(400).json({ error: "Time Out already recorded." });
        }
        if (log.lunchStart.getTime() === log.timeIn.getTime()) {
          return res.status(400).json({ error: "Please record Lunch Start first." });
        }
        if (log.lunchEnd.getTime() === log.timeIn.getTime()) {
          return res.status(400).json({ error: "Please record Lunch End first." });
        }
        const lStart = log.lunchStart;
        const lEnd = (data.lunchEnd as Date) || log.lunchEnd;
        const hoursWorked = calcWorkedMinutes(log.timeIn, ts, lStart, lEnd);

        const trainee = await prisma.trainee.findUnique({
          where: { id: log.traineeId },
          select: { workSchedule: true },
        });
        const standardMinutes = getStandardMinutesForDay(
          trainee?.workSchedule as WorkScheduleMap | null,
          log.date.getDay(),
        );

        data.timeOut = ts;
        data.hoursWorked = hoursWorked;
        data.overtime = Math.max(0, hoursWorked - standardMinutes);
        break;
      }

      case "accomplishment":
        if (!accomplishment) return res.status(400).json({ error: "Accomplishment text required." });
        data.accomplishment = accomplishment;
        break;

      case "offset": {
        if (!log.timeOut) {
          return res.status(400).json({ error: "Offset can only be applied after Time Out." });
        }

        const trainee = await prisma.trainee.findUnique({
          where: { id: log.traineeId },
          select: { requiredHours: true, workSchedule: true },
        });
        if (!trainee) return res.status(404).json({ error: "Trainee not found." });

        const logs = await prisma.logEntry.findMany({
          where: { traineeId: log.traineeId },
          select: { hoursWorked: true },
        });
        const renderedMinutes = logs.reduce((sum, l) => sum + l.hoursWorked, 0);
        const requiredMinutes = trainee.requiredHours * 60;
        if (renderedMinutes < requiredMinutes) {
          return res.status(400).json({ error: "Offset is allowed only after required hours are met." });
        }

        const scheduledMinutes = getStandardMinutesForDay(trainee.workSchedule as WorkScheduleMap | null, log.date.getDay());
        const intervalMinutes = calcWorkedMinutes(log.timeIn, log.timeOut, log.lunchStart, log.lunchEnd);
        if (intervalMinutes < scheduledMinutes) {
          return res.status(400).json({ error: "Offset requires a completed shift that satisfies the work schedule interval." });
        }

        const available = await getAvailableOffsetMinutes(log.traineeId);
        if (available <= 0) {
          return res.status(400).json({ error: "No available overtime minutes for offset." });
        }

        const requested = typeof offsetMinutes === "number" && offsetMinutes > 0 ? Math.floor(offsetMinutes) : available;
        const apply = Math.max(0, Math.min(requested, available));
        if (apply <= 0) {
          return res.status(400).json({ error: "Offset minutes must be greater than zero." });
        }

        data.offsetUsed = log.offsetUsed + apply;
        data.hoursWorked = log.hoursWorked + apply;
        break;
      }

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
