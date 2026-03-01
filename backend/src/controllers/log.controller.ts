// ============================================================
// Log Entry Controller
// Handles CRUD operations for trainee time-log entries.
// Includes lunch break fields and server-side hours calculation.
// ============================================================

import { Request, Response } from "express";
import { differenceInMinutes } from "date-fns";
import prisma from "../utils/prisma";

// ── Helper: calculate hoursWorked from time fields ───────────
function calcHoursWorked(timeIn: Date, timeOut: Date, lunchStart: Date, lunchEnd: Date): number {
  const totalMinutes = differenceInMinutes(timeOut, timeIn);
  const lunchMinutes = differenceInMinutes(lunchEnd, lunchStart);
  const workedMinutes = totalMinutes - lunchMinutes;
  return parseFloat((workedMinutes / 60).toFixed(2));
}

// ── Create a new log entry ───────────────────────────────────
export const createLog = async (req: Request, res: Response) => {
  try {
    const { traineeId, date, timeIn, timeOut, lunchStart, lunchEnd, accomplishment } = req.body;

    const logDate = new Date(date);
    const inDate = new Date(timeIn);
    const outDate = new Date(timeOut);
    const lStart = new Date(lunchStart);
    const lEnd = new Date(lunchEnd);

    // Check for duplicate log on the same date
    const duplicate = await prisma.logEntry.findUnique({
      where: { traineeId_date: { traineeId, date: logDate } },
    });
    if (duplicate) {
      return res.status(409).json({ error: "A log entry already exists for this date." });
    }

    // Server-side hours calculation
    const hoursWorked = calcHoursWorked(inDate, outDate, lStart, lEnd);

    const log = await prisma.logEntry.create({
      data: {
        traineeId,
        date: logDate,
        timeIn: inDate,
        lunchStart: lStart,
        lunchEnd: lEnd,
        timeOut: outDate,
        hoursWorked,
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

    // Also return the running total
    const totalHours = logs.reduce((sum, l) => sum + l.hoursWorked, 0);

    return res.json({ logs, totalHours });
  } catch (err) {
    console.error("getLogsByTrainee error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

// ── Update a log entry ───────────────────────────────────────
export const updateLog = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { date, timeIn, timeOut, lunchStart, lunchEnd, accomplishment } = req.body;

    // Fetch existing to fill in any missing fields
    const existing = await prisma.logEntry.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: "Log entry not found." });
    }

    const newDate = date ? new Date(date) : existing.date;
    const inDate = timeIn ? new Date(timeIn) : existing.timeIn;
    const outDate = timeOut ? new Date(timeOut) : existing.timeOut;
    const lStart = lunchStart ? new Date(lunchStart) : existing.lunchStart;
    const lEnd = lunchEnd ? new Date(lunchEnd) : existing.lunchEnd;

    // Check for duplicate log on the new date (exclude self)
    const duplicate = await prisma.logEntry.findFirst({
      where: {
        traineeId: existing.traineeId,
        date: newDate,
        id: { not: id },
      },
    });
    if (duplicate) {
      return res.status(409).json({ error: "A log entry already exists for this date." });
    }

    // Validate time ordering
    if (outDate <= inDate) return res.status(400).json({ error: "timeOut must be after timeIn." });
    if (lStart <= inDate) return res.status(400).json({ error: "lunchStart must be after timeIn." });
    if (lEnd >= outDate) return res.status(400).json({ error: "lunchEnd must be before timeOut." });
    if (lEnd <= lStart) return res.status(400).json({ error: "lunchEnd must be after lunchStart." });

    const hoursWorked = calcHoursWorked(inDate, outDate, lStart, lEnd);
    if (hoursWorked < 0) return res.status(400).json({ error: "hoursWorked cannot be negative." });

    const log = await prisma.logEntry.update({
      where: { id },
      data: {
        date: newDate,
        timeIn: inDate,
        lunchStart: lStart,
        lunchEnd: lEnd,
        timeOut: outDate,
        hoursWorked,
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
    return res.json({ message: "Log entry deleted." });
  } catch (err) {
    console.error("deleteLog error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};
