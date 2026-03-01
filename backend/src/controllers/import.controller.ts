// ============================================================
// Import Controller
// Parses an uploaded CSV file and inserts log entries into the
// database for a given trainee.
//
// Expected CSV columns:
//   date, timeIn, lunchStart, lunchEnd, timeOut, accomplishment
// ============================================================

import { Request, Response } from "express";
import { parse } from "csv-parse/sync";
import { differenceInMinutes } from "date-fns";
import prisma from "../utils/prisma";

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

    // Parse CSV content
    const records: Array<{
      date: string;
      timeIn: string;
      lunchStart?: string;
      lunchEnd?: string;
      timeOut: string;
      accomplishment?: string;
    }> = parse(file.buffer.toString(), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    const created = [];

    for (const row of records) {
      const inDate = new Date(row.timeIn);
      const outDate = new Date(row.timeOut);

      // Default lunch to 12:00–13:00 on the same date if not provided
      const dateStr = row.date.slice(0, 10); // "YYYY-MM-DD"
      const lStart = row.lunchStart ? new Date(row.lunchStart) : new Date(`${dateStr}T12:00:00`);
      const lEnd = row.lunchEnd ? new Date(row.lunchEnd) : new Date(`${dateStr}T13:00:00`);

      // Validate ordering
      if (outDate <= inDate) continue;
      if (lStart <= inDate || lEnd >= outDate || lEnd <= lStart) continue;

      const totalMinutes = differenceInMinutes(outDate, inDate);
      const lunchMinutes = differenceInMinutes(lEnd, lStart);
      const hoursWorked = parseFloat(((totalMinutes - lunchMinutes) / 60).toFixed(2));

      if (hoursWorked < 0) continue;

      const log = await prisma.logEntry.create({
        data: {
          traineeId,
          date: new Date(row.date),
          timeIn: inDate,
          lunchStart: lStart,
          lunchEnd: lEnd,
          timeOut: outDate,
          hoursWorked,
          accomplishment: row.accomplishment || "",
        },
      });

      created.push(log);
    }

    return res.status(201).json({ imported: created.length, logs: created });
  } catch (err) {
    console.error("importCSV error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};
