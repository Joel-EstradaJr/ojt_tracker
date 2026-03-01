// ============================================================
// Export Controller
// Exports a trainee's log entries to CSV, Excel, or PDF.
// Updated for new schema: lunchStart, lunchEnd, hoursWorked, accomplishment
// ============================================================

import { Request, Response } from "express";
import { format } from "date-fns";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import prisma from "../utils/prisma";
import { calculateExpectedEndDate } from "../utils/ph-holidays";

// ── Helper: fetch trainee + logs ─────────────────────────────
async function getTraineeWithLogs(traineeId: string) {
  const trainee = await prisma.trainee.findUnique({
    where: { id: traineeId },
    include: { logs: { orderBy: { date: "asc" } } },
  });
  return trainee;
}

// Title-case a string (capitalise first letter of each word)
function titleCase(str: string): string {
  return str
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

// Build display name from structured fields (title-cased)
function displayName(t: { lastName: string; firstName: string; middleName?: string | null; suffix?: string | null }) {
  const parts = [titleCase(t.firstName)];
  if (t.middleName) parts.push(titleCase(t.middleName));
  parts.push(titleCase(t.lastName));
  if (t.suffix) parts.push(t.suffix);
  return parts.join(" ");
}

// ── Export as CSV ────────────────────────────────────────────
export const exportCSV = async (req: Request, res: Response) => {
  try {
    const { traineeId } = req.params;
    const trainee = await getTraineeWithLogs(traineeId);

    if (!trainee) return res.status(404).json({ error: "Trainee not found." });

    const name = displayName(trainee);
    const header = "Date,Time In,Lunch Start,Lunch End,Time Out,Hours Worked,Overtime,Offset Used,Accomplishment\n";
    const rows = trainee.logs
      .map(
        (l) =>
          `${format(l.date, "yyyy-MM-dd")},${format(l.timeIn, "HH:mm")},${format(l.lunchStart, "HH:mm")},${format(l.lunchEnd, "HH:mm")},${format(l.timeOut, "HH:mm")},${l.hoursWorked},${l.overtime},${l.offsetUsed},"${(l.accomplishment ?? "").replace(/"/g, '""')}"`
      )
      .join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=${name}_logs.csv`);
    return res.send(header + rows);
  } catch (err) {
    console.error("exportCSV error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

// ── Export as Excel (.xlsx) ──────────────────────────────────
export const exportExcel = async (req: Request, res: Response) => {
  try {
    const { traineeId } = req.params;
    const trainee = await getTraineeWithLogs(traineeId);

    if (!trainee) return res.status(404).json({ error: "Trainee not found." });

    const name = displayName(trainee);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Logs");

    sheet.columns = [
      { header: "Date", key: "date", width: 15 },
      { header: "Time In", key: "timeIn", width: 12 },
      { header: "Lunch Start", key: "lunchStart", width: 14 },
      { header: "Lunch End", key: "lunchEnd", width: 14 },
      { header: "Time Out", key: "timeOut", width: 12 },
      { header: "Hours Worked", key: "hoursWorked", width: 14 },
      { header: "Overtime", key: "overtime", width: 12 },
      { header: "Offset Used", key: "offsetUsed", width: 14 },
      { header: "Accomplishment", key: "accomplishment", width: 40 },
    ];

    trainee.logs.forEach((l) => {
      sheet.addRow({
        date: format(l.date, "yyyy-MM-dd"),
        timeIn: format(l.timeIn, "HH:mm"),
        lunchStart: format(l.lunchStart, "HH:mm"),
        lunchEnd: format(l.lunchEnd, "HH:mm"),
        timeOut: format(l.timeOut, "HH:mm"),
        hoursWorked: l.hoursWorked,
        overtime: l.overtime,
        offsetUsed: l.offsetUsed,
        accomplishment: l.accomplishment ?? "",
      });
    });

    // Summary row
    const totalHrs = trainee.logs.reduce((s, l) => s + l.hoursWorked, 0);
    const remainHrs = Math.max(0, trainee.requiredHours - totalHrs);
    const remainDays = Math.ceil(remainHrs / 8);
    sheet.addRow({});
    sheet.addRow({ date: "Total Hours", timeIn: totalHrs.toFixed(2) });
    sheet.addRow({ date: "Remaining", timeIn: `${remainHrs.toFixed(1)} hrs (${remainDays} days)` });
    if (remainHrs > 0) {
      const endDate = calculateExpectedEndDate(remainDays);
      sheet.addRow({ date: "Expected End Date", timeIn: format(endDate, "MMMM d, yyyy (EEEE)") });
    }

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename=${name}_logs.xlsx`);

    await workbook.xlsx.write(res);
    return res.end();
  } catch (err) {
    console.error("exportExcel error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

// ── Export as PDF ────────────────────────────────────────────
export const exportPDF = async (req: Request, res: Response) => {
  try {
    const { traineeId } = req.params;
    const trainee = await getTraineeWithLogs(traineeId);

    if (!trainee) return res.status(404).json({ error: "Trainee not found." });

    const name = displayName(trainee);
    const doc = new PDFDocument({ margin: 40, size: "A4" });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=${name}_logs.pdf`);
    doc.pipe(res);

    // Title
    doc.fontSize(18).text(`OJT Logs — ${name}`, { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(11).text(`School: ${trainee.school}  |  Company: ${trainee.companyName}  |  Required Hours: ${trainee.requiredHours}`);
    doc.moveDown(1);

    const totalHours = trainee.logs.reduce((s, l) => s + l.hoursWorked, 0);
    const totalOT = trainee.logs.reduce((s, l) => s + l.overtime, 0);
    doc.fontSize(10);

    trainee.logs.forEach((l) => {
      doc.text(
        `${format(l.date, "yyyy-MM-dd")}  |  ${format(l.timeIn, "HH:mm")} – ${format(l.timeOut, "HH:mm")}  |  Lunch: ${format(l.lunchStart, "HH:mm")}–${format(l.lunchEnd, "HH:mm")}  |  ${l.hoursWorked} hrs  |  OT: ${l.overtime}  |  Offset: ${l.offsetUsed}  |  ${l.accomplishment ?? ""}`
      );
    });

    doc.moveDown(1);
    doc.fontSize(12).text(`Total Hours: ${totalHours.toFixed(2)} / ${trainee.requiredHours}  |  Total Overtime: ${totalOT.toFixed(2)}`);

    const remainHrs = Math.max(0, trainee.requiredHours - totalHours);
    const remainDays = Math.ceil(remainHrs / 8);
    doc.text(`Remaining: ${remainHrs.toFixed(1)} hrs (${remainDays} day${remainDays !== 1 ? "s" : ""})`);
    if (remainHrs > 0) {
      const endDate = calculateExpectedEndDate(remainDays);
      doc.text(`Expected End Date: ${format(endDate, "MMMM d, yyyy (EEEE)")}`);
    } else {
      doc.text("OJT hours completed!");
    }

    doc.end();
  } catch (err) {
    console.error("exportPDF error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};
