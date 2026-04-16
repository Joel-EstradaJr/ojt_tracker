import { Request, Response } from "express";
import { differenceInMinutes } from "date-fns";
import prisma from "../utils/prisma";

const DEFAULT_STANDARD_MINUTES = 8 * 60;
const STANDARD_LUNCH_MINUTES = 60;

type ScheduleEntry = { dayOfWeek: number; startTime: Date; endTime: Date };

function getScheduleForDay(schedule: ScheduleEntry[] | null | undefined, dayOfWeek: number): ScheduleEntry | null {
  return (schedule || []).find((entry) => entry.dayOfWeek === dayOfWeek) || null;
}

function getStandardMinutesForDay(schedule: ScheduleEntry[] | null | undefined, dayOfWeek: number): number {
  const dayEntry = getScheduleForDay(schedule, dayOfWeek);
  if (!dayEntry) return DEFAULT_STANDARD_MINUTES;
  const totalMinutes = differenceInMinutes(dayEntry.endTime, dayEntry.startTime);
  const workedMinutes = totalMinutes - STANDARD_LUNCH_MINUTES;
  return workedMinutes > 0 ? workedMinutes : DEFAULT_STANDARD_MINUTES;
}

function timeToMinutes(t: Date): number {
  return t.getHours() * 60 + t.getMinutes();
}

function calcWorkedMinutes(timeIn: Date, timeOut: Date, lunchStart: Date, lunchEnd: Date): number {
  const totalMinutes = differenceInMinutes(timeOut, timeIn);
  const actualLunchMinutes = differenceInMinutes(lunchEnd, lunchStart);
  const hasLunch = actualLunchMinutes > 0;
  const lunchDeduction = hasLunch ? Math.max(actualLunchMinutes, STANDARD_LUNCH_MINUTES) : 0;
  return Math.max(0, totalMinutes - lunchDeduction);
}

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

function calculateOvertime(
  timeIn: Date,
  timeOut: Date,
  lunchStart: Date,
  lunchEnd: Date,
  scheduleEntry: ScheduleEntry | null,
  settings: OvertimeSettings,
): number {
  if (!scheduleEntry) return 0;

  const scheduledStartMin = timeToMinutes(scheduleEntry.startTime);
  const scheduledEndMin = timeToMinutes(scheduleEntry.endTime);

  const actualInMin = timeToMinutes(timeIn);
  const actualOutMin = timeToMinutes(timeOut);

  let totalOTMinutes = 0;

  if (settings.countEarlyInAsOT && actualInMin < scheduledStartMin) {
    totalOTMinutes += scheduledStartMin - actualInMin;
  }

  if (settings.countLateOutAsOT && actualOutMin > scheduledEndMin) {
    totalOTMinutes += actualOutMin - scheduledEndMin;
  }

  if (settings.countEarlyLunchEndAsOT) {
    const actualLunchMinutes = differenceInMinutes(lunchEnd, lunchStart);
    if (actualLunchMinutes > 0 && actualLunchMinutes < STANDARD_LUNCH_MINUTES) {
      totalOTMinutes += STANDARD_LUNCH_MINUTES - actualLunchMinutes;
    }
  }

  return Math.max(0, Math.floor(totalOTMinutes));
}

async function getAvailableOffsetMinutes(traineeId: string, excludeLogId?: string): Promise<number> {
  const rows = await prisma.overtimeLedger.findMany({
    where: {
      traineeId,
      ...(excludeLogId ? { sourceLogId: { not: excludeLogId } } : {}),
    },
    select: { type: true, hours: true },
  });

  const earned = rows.filter((r) => r.type === "EARNED" || r.type === "ADJUSTED").reduce((s, r) => s + r.hours, 0);
  const used = rows.filter((r) => r.type === "USED").reduce((s, r) => s + r.hours, 0);
  return Math.max(0, Math.floor(earned - used));
}

async function syncLedgerForLog(log: { id: string; traineeId: string; overtime: number; offsetUsed: number }) {
  if (log.overtime > 0) {
    await prisma.overtimeLedger.upsert({
      where: { sourceLogId_type: { sourceLogId: log.id, type: "EARNED" } },
      create: {
        traineeId: log.traineeId,
        sourceLogId: log.id,
        type: "EARNED",
        hours: log.overtime,
      },
      update: { hours: log.overtime },
    });
  } else {
    await prisma.overtimeLedger.deleteMany({ where: { sourceLogId: log.id, type: "EARNED" } });
  }

  if (log.offsetUsed > 0) {
    await prisma.overtimeLedger.upsert({
      where: { sourceLogId_type: { sourceLogId: log.id, type: "USED" } },
      create: {
        traineeId: log.traineeId,
        sourceLogId: log.id,
        type: "USED",
        hours: log.offsetUsed,
      },
      update: { hours: log.offsetUsed },
    });
  } else {
    await prisma.overtimeLedger.deleteMany({ where: { sourceLogId: log.id, type: "USED" } });
  }
}

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

    const duplicate = await prisma.logEntry.findUnique({ where: { traineeId_date: { traineeId, date: logDate } } });
    if (duplicate) return res.status(409).json({ error: "A log entry already exists for this date." });

    if (!timeOut) {
      const log = await prisma.logEntry.create({
        data: {
          traineeId,
          date: logDate,
          timeIn: inDate,
          lunchStart: inDate,
          lunchEnd: inDate,
          hoursWorked: 0,
          overtime: 0,
          offsetUsed: 0,
          accomplishment: accomplishment || null,
        },
      });
      return res.status(201).json(log);
    }

    const outDate = new Date(timeOut);
    const lStart = lunchStart ? new Date(lunchStart) : inDate;
    const lEnd = lunchEnd ? new Date(lunchEnd) : inDate;

    const trainee = await prisma.userProfile.findUnique({
      where: { id: traineeId },
      select: { workSchedule: true },
    });

    const standardMinutes = getStandardMinutesForDay(trainee?.workSchedule, logDate.getDay());

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

    await syncLedgerForLog(log);
    return res.status(201).json(log);
  } catch (err) {
    console.error("createLog error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

export const getLogsByTrainee = async (req: Request, res: Response) => {
  try {
    const { traineeId } = req.params;

    const logs = await prisma.logEntry.findMany({ where: { traineeId }, orderBy: { date: "desc" } });

    const totalHours = logs.reduce((sum, l) => sum + l.hoursWorked, 0);
    const totalOvertime = logs.reduce((sum, l) => sum + l.overtime, 0);
    const totalOffsetUsed = logs.reduce((sum, l) => sum + l.offsetUsed, 0);
    const availableOffset = await getAvailableOffsetMinutes(traineeId);

    return res.json({ logs, totalHours, totalOvertime, totalOffsetUsed, availableOffset });
  } catch (err) {
    console.error("getLogsByTrainee error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

export const updateLog = async (req: Request, res: Response) => {
  try {
    const auth = (req as Request & { auth?: { role: "admin" | "trainee"; traineeId?: string } }).auth;
    const { entryId: id } = req.params;
    const {
      date, timeIn, timeOut, lunchStart, lunchEnd,
      accomplishment, applyOffset, offsetAmount,
    } = req.body;

    const existing = await prisma.logEntry.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Log entry not found." });
    if (auth?.role === "trainee" && auth.traineeId !== existing.traineeId) {
      return res.status(403).json({ error: "Access denied." });
    }

    if (auth?.role === "trainee") {
      const hasLockedFieldUpdate = [date, timeIn, timeOut, lunchStart, lunchEnd].some((v) => v !== undefined);
      if (hasLockedFieldUpdate) {
        return res.status(400).json({ error: "Only accomplishment and offset fields can be edited from trainee entry logs." });
      }
    }

    const newDate = date ? new Date(date) : existing.date;
    const inDate = timeIn ? new Date(timeIn) : existing.timeIn;
    const outDate = timeOut ? new Date(timeOut) : existing.timeOut;
    const lStart = lunchStart ? new Date(lunchStart) : existing.lunchStart;
    const lEnd = lunchEnd ? new Date(lunchEnd) : existing.lunchEnd;

    const duplicate = await prisma.logEntry.findFirst({
      where: { traineeId: existing.traineeId, date: newDate, id: { not: id } },
    });
    if (duplicate) return res.status(409).json({ error: "A log entry already exists for this date." });

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

      const trainee = await prisma.userProfile.findUnique({
        where: { id: existing.traineeId },
        select: { workSchedule: true },
      });

      const settings = await getOvertimeSettings();
      const scheduleEntry = getScheduleForDay(trainee?.workSchedule, newDate.getDay());
      const overtimeBySettings = calculateOvertime(inDate, outDate, lStart, lEnd, scheduleEntry, settings);
      const scheduleBased = Math.max(0, calcWorkedMinutes(inDate, outDate, lStart, lEnd) - getStandardMinutesForDay(trainee?.workSchedule, newDate.getDay()));

      hoursWorked = calcWorkedMinutes(inDate, outDate, lStart, lEnd);
      overtime = Math.max(overtimeBySettings, scheduleBased);
    }

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

    await syncLedgerForLog(log);
    return res.json(log);
  } catch (err) {
    console.error("updateLog error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

export const deleteLog = async (req: Request, res: Response) => {
  try {
    const auth = (req as Request & { auth?: { role: "admin" | "trainee"; traineeId?: string } }).auth;
    const { entryId: id } = req.params;

    if (auth?.role === "trainee") {
      const existing = await prisma.logEntry.findUnique({ where: { id }, select: { traineeId: true } });
      if (!existing) return res.status(404).json({ error: "Log entry not found." });
      if (auth.traineeId !== existing.traineeId) return res.status(403).json({ error: "Access denied." });
    }

    await prisma.$transaction([
      prisma.overtimeLedger.deleteMany({ where: { sourceLogId: id } }),
      prisma.logEntry.delete({ where: { id } }),
    ]);

    return res.json({ message: "Log entry deleted." });
  } catch (err) {
    console.error("deleteLog error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

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
        if (log.timeOut) return res.status(400).json({ error: "Cannot start lunch after Time Out." });
        if (log.lunchStart.getTime() !== log.timeIn.getTime()) {
          return res.status(400).json({ error: "Lunch Start already recorded." });
        }
        data.lunchStart = ts;
        break;

      case "lunchEnd":
        if (log.timeOut) return res.status(400).json({ error: "Cannot end lunch after Time Out." });
        if (log.lunchStart.getTime() === log.timeIn.getTime()) {
          return res.status(400).json({ error: "Cannot end lunch without starting it." });
        }
        data.lunchEnd = ts;
        break;

      case "timeOut": {
        if (log.timeOut) return res.status(400).json({ error: "Time Out already recorded." });
        if (log.lunchStart.getTime() === log.timeIn.getTime()) {
          return res.status(400).json({ error: "Please record Lunch Start first." });
        }
        if (log.lunchEnd.getTime() === log.timeIn.getTime()) {
          return res.status(400).json({ error: "Please record Lunch End first." });
        }

        const lStart = log.lunchStart;
        const lEnd = (data.lunchEnd as Date) || log.lunchEnd;
        const hoursWorked = calcWorkedMinutes(log.timeIn, ts, lStart, lEnd);

        const trainee = await prisma.userProfile.findUnique({
          where: { id: log.traineeId },
          select: { workSchedule: true },
        });

        const settings = await getOvertimeSettings();
        const scheduleEntry = getScheduleForDay(trainee?.workSchedule, log.date.getDay());
        const overtime = calculateOvertime(log.timeIn, ts, lStart, lEnd, scheduleEntry, settings);

        data.timeOut = ts;
        data.hoursWorked = hoursWorked;
        data.overtime = overtime;
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

        const trainee = await prisma.userProfile.findUnique({
          where: { id: log.traineeId },
          select: { requiredHours: true, workSchedule: true },
        });
        if (!trainee) return res.status(404).json({ error: "Trainee not found." });

        const logs = await prisma.logEntry.findMany({ where: { traineeId: log.traineeId }, select: { hoursWorked: true } });
        const renderedMinutes = logs.reduce((sum, l) => sum + l.hoursWorked, 0);
        const requiredMinutes = trainee.requiredHours * 60;
        if (renderedMinutes < requiredMinutes) {
          return res.status(400).json({ error: "Offset is allowed only after required hours are met." });
        }

        const scheduledMinutes = getStandardMinutesForDay(trainee.workSchedule, log.date.getDay());
        const intervalMinutes = calcWorkedMinutes(log.timeIn, log.timeOut, log.lunchStart, log.lunchEnd);
        if (intervalMinutes < scheduledMinutes) {
          return res.status(400).json({ error: "Offset requires a completed shift that satisfies the work schedule interval." });
        }

        const available = await getAvailableOffsetMinutes(log.traineeId, id);
        if (available <= 0) return res.status(400).json({ error: "No available overtime minutes for offset." });

        const requested = typeof offsetMinutes === "number" && offsetMinutes > 0 ? Math.floor(offsetMinutes) : available;
        const apply = Math.max(0, Math.min(requested, available));
        if (apply <= 0) return res.status(400).json({ error: "Offset minutes must be greater than zero." });

        data.offsetUsed = apply;
        data.hoursWorked = log.hoursWorked - log.offsetUsed + apply;
        break;
      }

      default:
        return res.status(400).json({ error: `Invalid action: ${action}` });
    }

    const updated = await prisma.logEntry.update({ where: { id }, data });
    await syncLedgerForLog(updated);
    return res.json(updated);
  } catch (err) {
    console.error("patchLogAction error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

