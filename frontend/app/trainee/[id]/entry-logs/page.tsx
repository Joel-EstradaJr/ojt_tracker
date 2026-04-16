"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { deleteLog, patchLogAction } from "@/lib/api";
import ImportCSV from "@/components/ImportCSV";
import ExportFormatButton from "@/components/ExportFormatButton";
import LogForm from "@/components/LogForm";
import DatePicker from "@/components/DatePicker";
import TimePicker from "@/components/TimePicker";
import RightSidebarDrawer from "@/components/RightSidebarDrawer";
import { LogEntry } from "@/types";
import { ThemeToggle } from "@/components/ThemeProvider";
import PageHeading from "@/components/PageHeading";
import { useTraineePageData } from "../components/useTraineePageData";
import { formatMinutes } from "@/lib/duration";
import { useActionGuard } from "@/lib/useActionGuard";
import { formatDisplayDate } from "@/lib/date";
import { exportElementToPdf, exportRowsAsCSV, exportRowsAsExcel } from "@/lib/export-utils";

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function TraineeEntryLogsPage() {
  const { runGuarded } = useActionGuard();
  const router = useRouter();
  const {
    id,
    trainee,
    logs,
    totalHours,
    availableOffset,
    loading,
    authChecking,
    viewerRole,
    percent,
    activeUserLabel,
    loadData,
  } = useTraineePageData();

  const [editingLog, setEditingLog] = useState<LogEntry | null>(null);
  const [deletingLog, setDeletingLog] = useState<LogEntry | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [offsetLog, setOffsetLog] = useState<LogEntry | null>(null);
  const [offsetMinutes, setOffsetMinutes] = useState("");
  const [offsetLoading, setOffsetLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState<"csv" | "excel" | "pdf" | null>(null);
  const [showFiltersModal, setShowFiltersModal] = useState(false);
  const [filterError, setFilterError] = useState("");
  const exportRootRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState("");
  const [sortField, setSortField] = useState<"date" | "timeIn" | "timeOut" | "lunchStart" | "lunchEnd" | "hoursWorked" | "overtime" | "offsetUsed" | "accomplishment">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [timeInFrom, setTimeInFrom] = useState("");
  const [timeInTo, setTimeInTo] = useState("");
  const [timeOutFrom, setTimeOutFrom] = useState("");
  const [timeOutTo, setTimeOutTo] = useState("");
  const [lunchStartFrom, setLunchStartFrom] = useState("");
  const [lunchStartTo, setLunchStartTo] = useState("");
  const [lunchEndFrom, setLunchEndFrom] = useState("");
  const [lunchEndTo, setLunchEndTo] = useState("");
  const [hoursWorkedMin, setHoursWorkedMin] = useState("");
  const [hoursWorkedMax, setHoursWorkedMax] = useState("");
  const [offsetUsedMin, setOffsetUsedMin] = useState("");
  const [offsetUsedMax, setOffsetUsedMax] = useState("");

  const [draftDateFrom, setDraftDateFrom] = useState("");
  const [draftDateTo, setDraftDateTo] = useState("");
  const [draftTimeInFrom, setDraftTimeInFrom] = useState("");
  const [draftTimeInTo, setDraftTimeInTo] = useState("");
  const [draftTimeOutFrom, setDraftTimeOutFrom] = useState("");
  const [draftTimeOutTo, setDraftTimeOutTo] = useState("");
  const [draftLunchStartFrom, setDraftLunchStartFrom] = useState("");
  const [draftLunchStartTo, setDraftLunchStartTo] = useState("");
  const [draftLunchEndFrom, setDraftLunchEndFrom] = useState("");
  const [draftLunchEndTo, setDraftLunchEndTo] = useState("");
  const [draftHoursWorkedMin, setDraftHoursWorkedMin] = useState("");
  const [draftHoursWorkedMax, setDraftHoursWorkedMax] = useState("");
  const [draftOffsetUsedMin, setDraftOffsetUsedMin] = useState("");
  const [draftOffsetUsedMax, setDraftOffsetUsedMax] = useState("");

  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortField(field);
      setSortDir("desc");
    }
    setCurrentPage(1);
  };

  const toMinutes = (hhmm: string): number => {
    const [h, m] = hhmm.split(":").map(Number);
    return (h * 60) + m;
  };

  const toManilaClockMinutes = (iso: string): number => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Manila",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(iso));
    const hour = Number(parts.find((p) => p.type === "hour")?.value || "0");
    const minute = Number(parts.find((p) => p.type === "minute")?.value || "0");
    return (hour * 60) + minute;
  };

  const isPlaceholderLunch = (targetIso: string | null | undefined, timeInIso: string | null | undefined): boolean => {
    if (!targetIso || !timeInIso) return true;
    return new Date(targetIso).getTime() === new Date(timeInIso).getTime();
  };

  const toManilaDateKey = (iso: string): string => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(iso));

    const year = parts.find((p) => p.type === "year")?.value || "0000";
    const month = parts.find((p) => p.type === "month")?.value || "01";
    const day = parts.find((p) => p.type === "day")?.value || "01";
    return `${year}-${month}-${day}`;
  };

  const toSearchClock = (iso?: string | null): string => {
    if (!iso) return "";
    return new Date(iso).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit" }).toLowerCase();
  };

  const toSearchFullDate = (iso: string): string =>
    new Date(iso).toLocaleDateString("en-PH", {
      timeZone: "Asia/Manila",
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).toLowerCase();

  const openFiltersModal = () => {
    setDraftDateFrom(dateFrom);
    setDraftDateTo(dateTo);
    setDraftTimeInFrom(timeInFrom);
    setDraftTimeInTo(timeInTo);
    setDraftTimeOutFrom(timeOutFrom);
    setDraftTimeOutTo(timeOutTo);
    setDraftLunchStartFrom(lunchStartFrom);
    setDraftLunchStartTo(lunchStartTo);
    setDraftLunchEndFrom(lunchEndFrom);
    setDraftLunchEndTo(lunchEndTo);
    setDraftHoursWorkedMin(hoursWorkedMin);
    setDraftHoursWorkedMax(hoursWorkedMax);
    setDraftOffsetUsedMin(offsetUsedMin);
    setDraftOffsetUsedMax(offsetUsedMax);
    setFilterError("");
    setShowFiltersModal(true);
  };

  const validateNonNegative = (value: string): boolean => value === "" || Number(value) >= 0;

  const applyFilters = () => {
    const nonNegativeOk =
      validateNonNegative(draftHoursWorkedMin) &&
      validateNonNegative(draftHoursWorkedMax) &&
      validateNonNegative(draftOffsetUsedMin) &&
      validateNonNegative(draftOffsetUsedMax);

    if (!nonNegativeOk) {
      setFilterError("Hours Worked and Offset Used cannot be negative.");
      return;
    }

    if (
      draftHoursWorkedMin !== "" && draftHoursWorkedMax !== "" && Number(draftHoursWorkedMin) > Number(draftHoursWorkedMax)
    ) {
      setFilterError("Hours Worked minimum cannot be greater than maximum.");
      return;
    }

    if (
      draftOffsetUsedMin !== "" && draftOffsetUsedMax !== "" && Number(draftOffsetUsedMin) > Number(draftOffsetUsedMax)
    ) {
      setFilterError("Offset Used minimum cannot be greater than maximum.");
      return;
    }

    if (draftDateFrom && draftDateTo && draftDateFrom > draftDateTo) {
      setFilterError("Date From cannot be later than Date To.");
      return;
    }

    if (draftTimeInFrom && draftTimeInTo && toMinutes(draftTimeInFrom) > toMinutes(draftTimeInTo)) {
      setFilterError("Time In From cannot be later than Time In To.");
      return;
    }

    if (draftTimeOutFrom && draftTimeOutTo && toMinutes(draftTimeOutFrom) > toMinutes(draftTimeOutTo)) {
      setFilterError("Time Out From cannot be later than Time Out To.");
      return;
    }

    if (draftLunchStartFrom && draftLunchStartTo && toMinutes(draftLunchStartFrom) > toMinutes(draftLunchStartTo)) {
      setFilterError("Lunch Start From cannot be later than Lunch Start To.");
      return;
    }

    if (draftLunchEndFrom && draftLunchEndTo && toMinutes(draftLunchEndFrom) > toMinutes(draftLunchEndTo)) {
      setFilterError("Lunch End From cannot be later than Lunch End To.");
      return;
    }

    setDateFrom(draftDateFrom);
    setDateTo(draftDateTo);
    setTimeInFrom(draftTimeInFrom);
    setTimeInTo(draftTimeInTo);
    setTimeOutFrom(draftTimeOutFrom);
    setTimeOutTo(draftTimeOutTo);
    setLunchStartFrom(draftLunchStartFrom);
    setLunchStartTo(draftLunchStartTo);
    setLunchEndFrom(draftLunchEndFrom);
    setLunchEndTo(draftLunchEndTo);
    setHoursWorkedMin(draftHoursWorkedMin);
    setHoursWorkedMax(draftHoursWorkedMax);
    setOffsetUsedMin(draftOffsetUsedMin);
    setOffsetUsedMax(draftOffsetUsedMax);
    setCurrentPage(1);
    setFilterError("");
    setShowFiltersModal(false);
  };

  const clearFilters = () => {
    setDateFrom("");
    setDateTo("");
    setTimeInFrom("");
    setTimeInTo("");
    setTimeOutFrom("");
    setTimeOutTo("");
    setLunchStartFrom("");
    setLunchStartTo("");
    setLunchEndFrom("");
    setLunchEndTo("");
    setHoursWorkedMin("");
    setHoursWorkedMax("");
    setOffsetUsedMin("");
    setOffsetUsedMax("");

    setDraftDateFrom("");
    setDraftDateTo("");
    setDraftTimeInFrom("");
    setDraftTimeInTo("");
    setDraftTimeOutFrom("");
    setDraftTimeOutTo("");
    setDraftLunchStartFrom("");
    setDraftLunchStartTo("");
    setDraftLunchEndFrom("");
    setDraftLunchEndTo("");
    setDraftHoursWorkedMin("");
    setDraftHoursWorkedMax("");
    setDraftOffsetUsedMin("");
    setDraftOffsetUsedMax("");

    setFilterError("");
    setCurrentPage(1);
    setShowFiltersModal(false);
  };

  const nonNegativeInput = (
    value: string,
    setter: React.Dispatch<React.SetStateAction<string>>,
  ) => {
    if (value === "") {
      setter("");
      setFilterError("");
      return;
    }
    if (Number(value) < 0) {
      setFilterError("Hours Worked and Offset Used cannot be negative.");
      return;
    }
    setFilterError("");
    setter(value);
  };

  const activeFilterCount =
    Number(Boolean(dateFrom)) +
    Number(Boolean(dateTo)) +
    Number(Boolean(timeInFrom)) +
    Number(Boolean(timeInTo)) +
    Number(Boolean(timeOutFrom)) +
    Number(Boolean(timeOutTo)) +
    Number(Boolean(lunchStartFrom)) +
    Number(Boolean(lunchStartTo)) +
    Number(Boolean(lunchEndFrom)) +
    Number(Boolean(lunchEndTo)) +
    Number(Boolean(hoursWorkedMin)) +
    Number(Boolean(hoursWorkedMax)) +
    Number(Boolean(offsetUsedMin)) +
    Number(Boolean(offsetUsedMax));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? logs.filter((log) => {
          const dateStr = formatDisplayDate(log.date).toLowerCase();
          const dateFullStr = toSearchFullDate(log.date);
          const accomplishment = (log.accomplishment || "").toLowerCase();
          const timeIn = toSearchClock(log.timeIn);
          const timeOut = toSearchClock(log.timeOut);
          const lunchStart = isPlaceholderLunch(log.lunchStart, log.timeIn) ? "" : toSearchClock(log.lunchStart);
          const lunchEnd = isPlaceholderLunch(log.lunchEnd, log.timeIn) ? "" : toSearchClock(log.lunchEnd);
          const hoursWorked = formatMinutes(log.hoursWorked).toLowerCase();
          const overtime = formatMinutes(log.overtime).toLowerCase();
          const offsetUsed = formatMinutes(log.offsetUsed).toLowerCase();

          return (
            dateStr.includes(q) ||
            dateFullStr.includes(q) ||
            accomplishment.includes(q) ||
            timeIn.includes(q) ||
            timeOut.includes(q) ||
            lunchStart.includes(q) ||
            lunchEnd.includes(q) ||
            hoursWorked.includes(q) ||
            overtime.includes(q) ||
            offsetUsed.includes(q)
          );
        })
      : logs;

    const withFilters = base.filter((log) => {
      const entryDateKey = toManilaDateKey(log.date);
      if (dateFrom && entryDateKey < dateFrom) return false;
      if (dateTo && entryDateKey > dateTo) return false;

      const timeInMins = toManilaClockMinutes(log.timeIn);
      if (timeInFrom && timeInMins < toMinutes(timeInFrom)) return false;
      if (timeInTo && timeInMins > toMinutes(timeInTo)) return false;

      const hasTimeOut = Boolean(log.timeOut);
      if (timeOutFrom || timeOutTo) {
        if (!hasTimeOut) return false;
        const outMins = toManilaClockMinutes(log.timeOut as string);
        if (timeOutFrom && outMins < toMinutes(timeOutFrom)) return false;
        if (timeOutTo && outMins > toMinutes(timeOutTo)) return false;
      }

      const lunchStartPlaceholder = isPlaceholderLunch(log.lunchStart, log.timeIn);
      if (lunchStartFrom || lunchStartTo) {
        if (lunchStartPlaceholder) return false;
        const lsMins = toManilaClockMinutes(log.lunchStart);
        if (lunchStartFrom && lsMins < toMinutes(lunchStartFrom)) return false;
        if (lunchStartTo && lsMins > toMinutes(lunchStartTo)) return false;
      }

      const lunchEndPlaceholder = isPlaceholderLunch(log.lunchEnd, log.timeIn);
      if (lunchEndFrom || lunchEndTo) {
        if (lunchEndPlaceholder) return false;
        const leMins = toManilaClockMinutes(log.lunchEnd);
        if (lunchEndFrom && leMins < toMinutes(lunchEndFrom)) return false;
        if (lunchEndTo && leMins > toMinutes(lunchEndTo)) return false;
      }

      const workedHours = log.hoursWorked / 60;
      if (hoursWorkedMin !== "" && workedHours < Number(hoursWorkedMin)) return false;
      if (hoursWorkedMax !== "" && workedHours > Number(hoursWorkedMax)) return false;

      const offsetHours = log.offsetUsed / 60;
      if (offsetUsedMin !== "" && offsetHours < Number(offsetUsedMin)) return false;
      if (offsetUsedMax !== "" && offsetHours > Number(offsetUsedMax)) return false;

      return true;
    });

    return [...withFilters].sort((a, b) => {
      let aValue: number | string | null = null;
      let bValue: number | string | null = null;

      switch (sortField) {
        case "date":
          aValue = new Date(a.date).getTime();
          bValue = new Date(b.date).getTime();
          break;
        case "timeIn":
          aValue = toManilaClockMinutes(a.timeIn);
          bValue = toManilaClockMinutes(b.timeIn);
          break;
        case "timeOut":
          aValue = a.timeOut ? toManilaClockMinutes(a.timeOut) : null;
          bValue = b.timeOut ? toManilaClockMinutes(b.timeOut) : null;
          break;
        case "lunchStart":
          aValue = isPlaceholderLunch(a.lunchStart, a.timeIn) ? null : toManilaClockMinutes(a.lunchStart);
          bValue = isPlaceholderLunch(b.lunchStart, b.timeIn) ? null : toManilaClockMinutes(b.lunchStart);
          break;
        case "lunchEnd":
          aValue = isPlaceholderLunch(a.lunchEnd, a.timeIn) ? null : toManilaClockMinutes(a.lunchEnd);
          bValue = isPlaceholderLunch(b.lunchEnd, b.timeIn) ? null : toManilaClockMinutes(b.lunchEnd);
          break;
        case "hoursWorked":
          aValue = a.timeOut ? a.hoursWorked : null;
          bValue = b.timeOut ? b.hoursWorked : null;
          break;
        case "overtime":
          aValue = a.timeOut ? a.overtime : null;
          bValue = b.timeOut ? b.overtime : null;
          break;
        case "offsetUsed":
          aValue = typeof a.offsetUsed === "number" ? a.offsetUsed : null;
          bValue = typeof b.offsetUsed === "number" ? b.offsetUsed : null;
          break;
        case "accomplishment":
          aValue = (a.accomplishment || "").toLowerCase();
          bValue = (b.accomplishment || "").toLowerCase();
          break;
      }

      if (aValue === null && bValue === null) return 0;
      if (aValue === null) return 1;
      if (bValue === null) return -1;

      const cmp = typeof aValue === "string" && typeof bValue === "string"
        ? aValue.localeCompare(bValue)
        : Number(aValue) - Number(bValue);

      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [
    logs,
    query,
    sortField,
    sortDir,
    dateFrom,
    dateTo,
    timeInFrom,
    timeInTo,
    timeOutFrom,
    timeOutTo,
    lunchStartFrom,
    lunchStartTo,
    lunchEndFrom,
    lunchEndTo,
    hoursWorkedMin,
    hoursWorkedMax,
    offsetUsedMin,
    offsetUsedMax,
  ]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const paginatedLogs = filtered.slice(startIdx, startIdx + pageSize);
  const tableVisibleRows = 10;
  const tableRowHeight = 72;
  const tableHeaderHeight = 46;
  const fixedTableHeight = (tableVisibleRows * tableRowHeight) + tableHeaderHeight;

  const doDelete = async () => {
    await runGuarded("trainee-delete-log", async () => {
      if (!deletingLog) return;
      setDeleteLoading(true);
      try {
        await deleteLog(deletingLog.id);
        setDeletingLog(null);
        loadData();
      } finally {
        setDeleteLoading(false);
      }
    });
  };

  const getStandardMinutesForLog = (log: LogEntry): number => {
    if (!trainee) return 8 * 60;
    const ws = trainee.workSchedule as Record<string, { start: string; end: string }> | undefined;
    const day = new Date(log.date).getDay();
    const dayCfg = ws?.[String(day)];
    if (!dayCfg) return 8 * 60;
    const [sh, sm] = dayCfg.start.split(":").map(Number);
    const [eh, em] = dayCfg.end.split(":").map(Number);
    const span = (eh * 60 + em) - (sh * 60 + sm);
    return Math.max(0, span - 60);
  };

  const actualWorkedIntervalMinutes = (log: LogEntry): number => {
    if (!log.timeOut) return 0;
    const inMs = new Date(log.timeIn).getTime();
    const outMs = new Date(log.timeOut).getTime();
    const lunchStartMs = new Date(log.lunchStart).getTime();
    const lunchEndMs = new Date(log.lunchEnd).getTime();
    const lunchDeduction = lunchEndMs > lunchStartMs ? Math.max(0, Math.round((lunchEndMs - lunchStartMs) / 60000)) : 0;
    return Math.max(0, Math.round((outMs - inMs) / 60000) - lunchDeduction);
  };

  const canOffset = (log: LogEntry): boolean => {
    if (!trainee) return false;
    if (!log.timeOut) return false;
    if (availableOffset <= 0) return false;
    if (log.overtime > 0) return false;
    const requiredMinutes = trainee.requiredHours * 60;
    if (totalHours < requiredMinutes) return false;
    return actualWorkedIntervalMinutes(log) >= getStandardMinutesForLog(log);
  };

  const applyOffset = async () => {
    await runGuarded("trainee-offset", async () => {
      if (!offsetLog) return;
      setOffsetLoading(true);
      try {
        await patchLogAction(offsetLog.id, {
          action: "offset",
          offsetMinutes: offsetMinutes ? Math.floor(Number(offsetMinutes)) : undefined,
        });
        setOffsetLog(null);
        setOffsetMinutes("");
        loadData();
      } finally {
        setOffsetLoading(false);
      }
    });
  };

  const handleExport = async (format: "csv" | "excel" | "pdf") => {
    await runGuarded(`trainee-export-${format}`, async () => {
      setExportLoading(format);
      try {
        if (format === "pdf") {
          if (!exportRootRef.current) throw new Error("Could not export page preview.");
          await exportElementToPdf({
            element: exportRootRef.current,
            fileNameBase: `entry_logs_${id}`,
            orientation: "landscape",
          });
        } else {
          const timeFmt = (iso: string) =>
            new Date(iso).toLocaleTimeString("en-PH", {
              timeZone: "Asia/Manila",
              hour: "2-digit",
              minute: "2-digit",
            });

          const rows = filtered.map((log) => {
            const lunchStartIsPlaceholder = new Date(log.lunchStart).getTime() === new Date(log.timeIn).getTime();
            const lunchEndIsPlaceholder = new Date(log.lunchEnd).getTime() === new Date(log.timeIn).getTime();
            return {
              "Date": formatDisplayDate(log.date),
              "Time In": timeFmt(log.timeIn),
              "Lunch Start": lunchStartIsPlaceholder ? "-" : timeFmt(log.lunchStart),
              "Lunch End": lunchEndIsPlaceholder ? "-" : timeFmt(log.lunchEnd),
              "Time Out": log.timeOut ? timeFmt(log.timeOut) : "-",
              "Hours Worked": log.timeOut ? formatMinutes(log.hoursWorked) : "-",
              "Overtime": log.timeOut ? formatMinutes(log.overtime) : "-",
              "Offset Used": log.offsetUsed > 0 ? formatMinutes(log.offsetUsed) : "-",
              "Accomplishment": log.accomplishment || "",
            };
          });

          if (format === "csv") {
            exportRowsAsCSV(`entry_logs_${id}`, rows, ["Date", "Time In", "Lunch Start", "Lunch End", "Time Out", "Hours Worked", "Overtime", "Offset Used", "Accomplishment"]);
          } else {
            await exportRowsAsExcel(`entry_logs_${id}`, rows, "Entry Logs");
          }
        }
      } finally {
        setExportLoading(null);
      }
    });
  };

  if (authChecking || loading) {
    return (
      <div className="container">
        <div className="skeleton">
          <div className="skeleton-card" style={{ height: "220px" }}>
            <div className="skeleton-line medium" />
            <div className="skeleton-line short" />
            <div className="skeleton-line" />
            <div className="skeleton-line thin" />
          </div>
        </div>
      </div>
    );
  }

  if (!trainee) {
    return (
      <div className="container">
        <div className="empty-state">
          <h3>Trainee Not Found</h3>
        </div>
      </div>
    );
  }

  const sortTh = (field: typeof sortField, label: string) => (
    <th key={field} onClick={() => handleSort(field)} style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
        {label}
        {sortField === field ? (
          <span style={{ fontSize: "0.7rem", lineHeight: 1 }}>{sortDir === "asc" ? "▲" : "▼"}</span>
        ) : (
          <span style={{ fontSize: "0.7rem", opacity: 0.3, lineHeight: 1 }}>⇅</span>
        )}
      </span>
    </th>
  );

  return (
    <div className="container" ref={exportRootRef}>
      {viewerRole === "admin" && (
        <div style={{ marginBottom: "0.75rem" }}>
          <button className="btn btn-outline" onClick={() => router.push("/admin/trainee-management")} style={{ gap: "0.35rem" }}>
            <span aria-hidden="true">←</span>
            Back
          </button>
        </div>
      )}

      <PageHeading
        title="Entry Logs"
        subtitle="Manage your daily logs and export your records."
        actions={(
          <>
            <ThemeToggle />
          </>
        )}
        toolbar={(
          <>
            <ExportFormatButton
              loadingFormat={exportLoading}
              title="Export Records"
              description="Choose the export format for your own records."
              onSelect={handleExport}
            />
            <ImportCSV traineeId={id} onImported={loadData} />
          </>
        )}
        meta={<>LOGGED IN AS: <strong style={{ color: "var(--text)" }}>{activeUserLabel || "Trainee"}</strong></>}
      />

      <div className="card" style={{ marginBottom: "1rem", padding: "1rem 1.1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "0.8rem", alignItems: "flex-start", flexWrap: "wrap", marginBottom: "0.65rem" }}>
          <div>
            <h3 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: "0.15rem" }}>{trainee.displayName}</h3>
            <p style={{ fontSize: "0.84rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap" }}>
              {trainee.companyName && <span>{trainee.companyName}</span>}
              {trainee.companyName && <span style={{ opacity: 0.4 }}>|</span>}
              <span>{trainee.school}</span>
            </p>
          </div>
          <span className={percent >= 100 ? "badge badge-success" : "badge badge-primary"} style={{ fontSize: "0.76rem" }}>
            {percent}% Complete
          </span>
        </div>

        <div style={{ marginBottom: "0.65rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem" }}>
            <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>Progress</span>
            <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--primary)" }}>{percent}%</span>
          </div>
          <div className="progress-bar-track">
            <div className="progress-bar-fill" style={{ width: `${percent}%` }} />
          </div>
        </div>

        {trainee.workSchedule && Object.keys(trainee.workSchedule).length > 0 && (
          <div style={{ background: "var(--bg-subtle)", borderRadius: "var(--radius-sm)", padding: "0.65rem 0.75rem", border: "1px solid var(--border)" }}>
            <p style={{ fontSize: "0.76rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700, marginBottom: "0.35rem" }}>
              Work Schedule
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.3rem 0.75rem" }}>
              {Object.entries(trainee.workSchedule)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([dayNum, times]) => (
                  <div key={dayNum} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.84rem", color: "var(--text-secondary)", gap: "0.5rem" }}>
                    <span style={{ fontWeight: 600 }}>{DAY_LABELS[Number(dayNum)]}</span>
                    <span>{times.start} - {times.end}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      <LogForm
        traineeId={id}
        traineeDisplayName={trainee.displayName}
        onCreated={loadData}
        availableOffset={availableOffset}
        workSchedule={trainee.workSchedule}
        viewerRole={viewerRole}
        logs={logs}
      />

      {editingLog && (
        <RightSidebarDrawer onClose={() => setEditingLog(null)} width={620}>
          <LogForm
            traineeId={id}
            traineeDisplayName={trainee.displayName}
            onCreated={loadData}
            editingLog={editingLog}
            onCancelEdit={() => setEditingLog(null)}
            availableOffset={availableOffset}
            workSchedule={trainee.workSchedule}
            viewerRole={viewerRole}
            logs={logs}
          />
        </RightSidebarDrawer>
      )}

      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.05 }}>
        <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap" }}>
          <div className="form-group" style={{ marginBottom: 0, minWidth: 260, flex: "1 1 260px" }}>
            <input
              type="text"
              placeholder="Search by date or accomplishment..."
              value={query}
              onChange={(e) => { setQuery(e.target.value); setCurrentPage(1); }}
            />
          </div>
          <button className="btn btn-outline" onClick={openFiltersModal} style={{ whiteSpace: "nowrap", fontSize: "0.82rem", padding: "0.5rem 0.75rem" }}>
            Filter {activeFilterCount > 0 ? `(${activeFilterCount})` : ""}
          </button>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.35rem" }}>
            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Rows per page:</span>
            <select className="rows-per-page-select" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}>
              {[5, 10, 20, 50].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>

        <div
          style={{
            overflowX: "auto",
            overflowY: "auto",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border)",
            height: `${fixedTableHeight}px`,
          }}
        >
          <table className="logs-table entry-logs-table">
            <thead>
              <tr>
                {sortTh("date", "Date")}
                {sortTh("timeIn", "Time In")}
                {sortTh("lunchStart", "Lunch Start")}
                {sortTh("lunchEnd", "Lunch End")}
                {sortTh("timeOut", "Time Out")}
                {sortTh("hoursWorked", "Hours Worked")}
                {sortTh("overtime", "Overtime")}
                {sortTh("offsetUsed", "Offset Used")}
                {sortTh("accomplishment", "Accomplishment")}
                <th style={{ textAlign: "center" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedLogs.map((log) => {
                const dateStr = formatDisplayDate(log.date);
                const [weekday = "", monthDayYear = ""] = dateStr.split(" | ");
                const timeFmt = (iso: string) =>
                  new Date(iso).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit" });
                const lunchStartIsPlaceholder = new Date(log.lunchStart).getTime() === new Date(log.timeIn).getTime();
                const lunchEndIsPlaceholder = new Date(log.lunchEnd).getTime() === new Date(log.timeIn).getTime();
                return (
                  <tr key={log.id}>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2, gap: "0.1rem" }}>
                        <span>{weekday} |</span>
                        <span style={{ whiteSpace: "nowrap" }}>{monthDayYear}</span>
                      </div>
                    </td>
                    <td>{timeFmt(log.timeIn)}</td>
                    <td>{lunchStartIsPlaceholder ? <span style={{ color: "var(--text-faint)" }}>—</span> : timeFmt(log.lunchStart)}</td>
                    <td>{lunchEndIsPlaceholder ? <span style={{ color: "var(--text-faint)" }}>—</span> : timeFmt(log.lunchEnd)}</td>
                    <td>{log.timeOut ? timeFmt(log.timeOut) : <span style={{ color: "var(--text-faint)" }}>—</span>}</td>
                    <td>{log.timeOut ? formatMinutes(log.hoursWorked) : <span style={{ color: "var(--text-faint)" }}>—</span>}</td>
                    <td>{log.timeOut ? formatMinutes(log.overtime) : <span style={{ color: "var(--text-faint)" }}>—</span>}</td>
                    <td>{log.offsetUsed > 0 ? formatMinutes(log.offsetUsed) : <span style={{ color: "var(--text-faint)" }}>-</span>}</td>
                    <td className="accomplishment-cell"><div className="accomplishment-content">{log.accomplishment}</div></td>
                    <td style={{ textAlign: "center" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", alignItems: "center" }}>
                        <button className="btn btn-outline" style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem", width: "100%" }} onClick={() => setEditingLog(log)}>EDIT</button>
                        <button className="btn btn-danger" style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem", width: "100%" }} onClick={() => setDeletingLog(log)}>DELETE</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {paginatedLogs.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ textAlign: "center", padding: "2rem 1rem", color: "var(--text-muted)", fontSize: "0.88rem" }}>
                    No log entries found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="pagination-controls">
            <button className="btn btn-outline pagination-btn" disabled={safePage <= 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}>‹</button>
            <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>{safePage} / {totalPages}</span>
            <button className="btn btn-outline pagination-btn" disabled={safePage >= totalPages} onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}>›</button>
          </div>
        )}
      </motion.div>

      {showFiltersModal && (
        <div className="modal-overlay" onClick={() => setShowFiltersModal(false)}>
          <div
            className="modal-content"
            style={{
              maxWidth: 760,
              width: "min(92vw, 760px)",
              maxHeight: "85vh",
              display: "flex",
              flexDirection: "column",
              padding: 0,
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: "1rem 1.1rem 0.8rem", borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.75rem", marginBottom: "0.35rem" }}>
                <h2 style={{ fontSize: "1.1rem", margin: 0 }}>Entry Log Filters</h2>
              </div>
              <p style={{ margin: 0, fontSize: "0.82rem", color: "var(--text-muted)" }}>
                Set only the fields you need. Use From and To values to narrow exact ranges.
              </p>
            </div>

            <div style={{ overflowY: "auto", padding: "0.9rem 1.1rem 1rem" }}>
              {filterError && (
                <div style={{ background: "var(--danger-light)", border: "1px solid var(--danger)", borderRadius: "var(--radius-xs)", padding: "0.5rem 0.75rem", marginBottom: "0.75rem" }}>
                  <p style={{ color: "var(--danger)", fontSize: "0.84rem", margin: 0 }}>{filterError}</p>
                </div>
              )}

              <div style={{ display: "grid", gap: "0.85rem" }}>
                <section style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "0.8rem", background: "var(--bg-subtle)" }}>
                  <p style={{ margin: "0 0 0.55rem", fontSize: "0.76rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Date Range</p>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.6rem" }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label htmlFor="log-date-from">Date From</label>
                      <DatePicker value={draftDateFrom} onChange={setDraftDateFrom} />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label htmlFor="log-date-to">Date To</label>
                      <DatePicker value={draftDateTo} onChange={setDraftDateTo} />
                    </div>
                  </div>
                </section>

                <section style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "0.8rem", background: "var(--bg-subtle)" }}>
                  <p style={{ margin: "0 0 0.55rem", fontSize: "0.76rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Time Ranges</p>
                  <div style={{ display: "grid", gap: "0.6rem" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.6rem" }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label htmlFor="log-time-in-from">Time In From</label>
                        <TimePicker value={draftTimeInFrom} onChange={setDraftTimeInFrom} />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label htmlFor="log-time-in-to">Time In To</label>
                        <TimePicker value={draftTimeInTo} onChange={setDraftTimeInTo} />
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.6rem" }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label htmlFor="log-time-out-from">Time Out From</label>
                        <TimePicker value={draftTimeOutFrom} onChange={setDraftTimeOutFrom} />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label htmlFor="log-time-out-to">Time Out To</label>
                        <TimePicker value={draftTimeOutTo} onChange={setDraftTimeOutTo} />
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.6rem" }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label htmlFor="log-lunch-start-from">Lunch Start From</label>
                        <TimePicker value={draftLunchStartFrom} onChange={setDraftLunchStartFrom} />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label htmlFor="log-lunch-start-to">Lunch Start To</label>
                        <TimePicker value={draftLunchStartTo} onChange={setDraftLunchStartTo} />
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.6rem" }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label htmlFor="log-lunch-end-from">Lunch End From</label>
                        <TimePicker value={draftLunchEndFrom} onChange={setDraftLunchEndFrom} />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label htmlFor="log-lunch-end-to">Lunch End To</label>
                        <TimePicker value={draftLunchEndTo} onChange={setDraftLunchEndTo} />
                      </div>
                    </div>
                  </div>
                </section>

                <section style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "0.8rem", background: "var(--bg-subtle)" }}>
                  <p style={{ margin: "0 0 0.55rem", fontSize: "0.76rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Numeric Thresholds</p>
                  <div style={{ display: "grid", gap: "0.6rem" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.6rem" }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label htmlFor="log-hours-worked-min">Hours Worked Min</label>
                        <input
                          id="log-hours-worked-min"
                          type="number"
                          min="0"
                          step="0.5"
                          value={draftHoursWorkedMin}
                          onChange={(e) => nonNegativeInput(e.target.value, setDraftHoursWorkedMin)}
                          placeholder="e.g., 4"
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label htmlFor="log-hours-worked-max">Hours Worked Max</label>
                        <input
                          id="log-hours-worked-max"
                          type="number"
                          min="0"
                          step="0.5"
                          value={draftHoursWorkedMax}
                          onChange={(e) => nonNegativeInput(e.target.value, setDraftHoursWorkedMax)}
                          placeholder="e.g., 9"
                        />
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.6rem" }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label htmlFor="log-offset-used-min">Offset Used Min</label>
                        <input
                          id="log-offset-used-min"
                          type="number"
                          min="0"
                          step="0.5"
                          value={draftOffsetUsedMin}
                          onChange={(e) => nonNegativeInput(e.target.value, setDraftOffsetUsedMin)}
                          placeholder="e.g., 0"
                        />
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label htmlFor="log-offset-used-max">Offset Used Max</label>
                        <input
                          id="log-offset-used-max"
                          type="number"
                          min="0"
                          step="0.5"
                          value={draftOffsetUsedMax}
                          onChange={(e) => nonNegativeInput(e.target.value, setDraftOffsetUsedMax)}
                          placeholder="e.g., 2"
                        />
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.6rem", padding: "0.8rem 1.1rem 1rem", borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
              <button className="btn btn-outline" onClick={clearFilters}>Clear</button>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button className="btn btn-outline" onClick={() => { setFilterError(""); setShowFiltersModal(false); }}>Cancel</button>
                <button className="btn btn-primary" onClick={applyFilters}>Apply</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {deletingLog && (
        <div className="modal-overlay" onClick={() => !deleteLoading && setDeletingLog(null)}>
          <div className="modal-content" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: "1.1rem", color: "var(--danger)", marginBottom: "0.5rem" }}>Delete Log Entry</h2>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "1rem" }}>This action cannot be undone.</p>
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button className="btn btn-outline" onClick={() => setDeletingLog(null)} disabled={deleteLoading}>Cancel</button>
              <button className="btn btn-danger" onClick={doDelete} disabled={deleteLoading}>{deleteLoading ? "Deleting..." : "Delete"}</button>
            </div>
          </div>
        </div>
      )}

      {offsetLog && (
        <div className="modal-overlay" onClick={() => !offsetLoading && setOffsetLog(null)}>
          <div className="modal-content" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>Apply Offset</h2>
            <p style={{ fontSize: "0.84rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
              Available offset: <strong>{formatMinutes(availableOffset)}</strong>
            </p>
            <div className="form-group">
              <label>Offset Minutes To Apply</label>
              <input
                type="number"
                min="1"
                max={Math.max(1, availableOffset)}
                value={offsetMinutes}
                onChange={(e) => setOffsetMinutes(e.target.value)}
              />
            </div>
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button className="btn btn-outline" onClick={() => setOffsetLog(null)} disabled={offsetLoading}>Cancel</button>
              <button className="btn btn-primary" onClick={applyOffset} disabled={offsetLoading || !offsetMinutes || Number(offsetMinutes) <= 0}>
                {offsetLoading ? "Applying..." : "Apply Offset"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
