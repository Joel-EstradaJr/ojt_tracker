// ============================================================
// Log Entry Controller
// Handles CRUD operations for trainee time-log entries.
// Includes lunch break fields, server-side hours calculation,
// overtime tracking, and offset (applying banked OT to future logs).
//
// ── Overtime & Offset Rules ──────────────────────────────────
// • Standard day = 8 worked hours (excluding lunch)
// • Overtime      = max(hoursWorked − 8, 0)
// • "Offset bank" = cumulative overtime across ALL of a
//   trainee's logs minus cumulative offset already used.
// • When creating/editing a log the client may request
//   `applyOffset: true` + optionally `offsetAmount`.
//   The server caps offsetUsed at the available bank.
// • Deleting a log removes its overtime contribution and
//   also removes offset it consumed.
// ============================================================

import { Request, Response } from "express";
import { differenceInMinutes } from "date-fns";
import prisma from "../utils/prisma";

const STANDARD_HOURS = 8;

// ── Helper: calculate hoursWorked from time fields ───────────
function calcHoursWorked(timeIn: Date, timeOut: Date, lunchStart: Date, lunchEnd: Date): number {
  const totalMinutes = differenceInMinutes(timeOut, timeIn);
  const lunchMinutes = differenceInMinutes(lunchEnd, lunchStart);
  const workedMinutes = totalMinutes - lunchMinutes;
  return parseFloat((workedMinutes / 60).toFixed(2));
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
export const createLog = async (req: Request, res: Response) => {
  try {
    const {
      traineeId, date, timeIn, timeOut, lunchStart, lunchEnd,
      accomplishment, applyOffset, offsetAmount,
    } = req.body;

    const logDate = new Date(date);
    const inDate = new Date(timeIn);
    const outDate = new Date(timeOut);
    const lStart = new Date(lunchStart);
    const lEnd = new Date(lunchEnd);

    // Duplicate-date guard
    const duplicate = await prisma.logEntry.findUnique({
      where: { traineeId_date: { traineeId, date: logDate } },
    });
    if (duplicate) {
      return res.status(409).json({ error: "A log entry already exists for this date." });
    }

    // Server-side hours & overtime calculation
    const hoursWorked = calcHoursWorked(inDate, outDate, lStart, lEnd);
    const overtime = parseFloat(Math.max(0, hoursWorked - STANDARD_HOURS).toFixed(2));

    // Offset: if the user wants to apply banked OT
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
        accomplishment,
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
    const { id } = req.params;
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

    // Validate time ordering
    if (outDate <= inDate) return res.status(400).json({ error: "timeOut must be after timeIn." });
    const hasLunch = lStart.getTime() !== lEnd.getTime();
    if (hasLunch) {
      if (lStart <= inDate) return res.status(400).json({ error: "lunchStart must be after timeIn." });
      if (lEnd >= outDate) return res.status(400).json({ error: "lunchEnd must be before timeOut." });
      if (lEnd <= lStart) return res.status(400).json({ error: "lunchEnd must be after lunchStart." });
    }

    const hoursWorked = calcHoursWorked(inDate, outDate, lStart, lEnd);
    if (hoursWorked < 0) return res.status(400).json({ error: "hoursWorked cannot be negative." });

    const overtime = parseFloat(Math.max(0, hoursWorked - STANDARD_HOURS).toFixed(2));

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
    const { id } = req.params;
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
// Convenience endpoint so the frontend can show "Available Offset"
// before the user submits a log.
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
