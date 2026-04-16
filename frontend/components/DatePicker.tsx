"use client";

// ============================================================
// Custom DatePicker with Philippine holiday & weekend coloring
// ============================================================

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { getHolidayMap, isWeekend, HolidayInfo } from "@/lib/ph-holidays";
import { formatDisplayDateFromDateOnly } from "@/lib/date";

interface Props {
  value: string;           // "yyyy-MM-dd"
  onChange: (v: string) => void;
  max?: string;            // "yyyy-MM-dd"
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function DatePicker({ value, onChange, max }: Props) {
  const [open, setOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"day" | "month" | "year">("day");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // Current calendar view (by month)
  const parsed = value ? new Date(value + "T00:00:00") : new Date();
  const [viewYear, setViewYear] = useState(parsed.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed.getMonth());

  // Re-sync view when value changes externally (e.g. reset)
  useEffect(() => {
    if (value) {
      const d = new Date(value + "T00:00:00");
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth());
    }
  }, [value]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        wrapperRef.current && !wrapperRef.current.contains(e.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Position the dropdown using fixed positioning relative to trigger
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const dropdownWidth = dropdownRef.current?.offsetWidth || 320;
    const viewportPadding = 8;
    const maxLeft = Math.max(viewportPadding, window.innerWidth - dropdownWidth - viewportPadding);
    const clampedLeft = Math.min(Math.max(rect.left, viewportPadding), maxLeft);
    setDropdownPos({
      top: rect.bottom + 4,
      left: clampedLeft,
    });
  }, []);

  useEffect(() => {
    if (open) {
      updatePosition();
      const raf = window.requestAnimationFrame(updatePosition);
      window.addEventListener("scroll", updatePosition, true);
      window.addEventListener("resize", updatePosition);
      return () => {
        window.cancelAnimationFrame(raf);
        window.removeEventListener("scroll", updatePosition, true);
        window.removeEventListener("resize", updatePosition);
      };
    }
  }, [open, updatePosition]);

  // Holiday map for current view year (+ adjacent if needed)
  const holidayMap = useMemo(() => {
    const m = new Map<string, HolidayInfo>();
    // Cover possible overflow into adjacent years
    for (const y of [viewYear - 1, viewYear, viewYear + 1]) {
      for (const [k, v] of getHolidayMap(y)) m.set(k, v);
    }
    return m;
  }, [viewYear]);

  // Build calendar grid
  const firstDay = new Date(viewYear, viewMonth, 1);
  const startDow = firstDay.getDay(); // 0=Sun
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  // Previous month fill
  const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate();
  const cells: { date: Date; inMonth: boolean }[] = [];
  for (let i = startDow - 1; i >= 0; i--) {
    cells.push({
      date: new Date(viewYear, viewMonth - 1, prevMonthDays - i),
      inMonth: false,
    });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(viewYear, viewMonth, d), inMonth: true });
  }
  // Next month fill to complete last row
  while (cells.length % 7 !== 0) {
    const nextDay = cells.length - startDow - daysInMonth + 1;
    cells.push({
      date: new Date(viewYear, viewMonth + 1, nextDay),
      inMonth: false,
    });
  }

  const maxDate = max ? new Date(max + "T23:59:59") : null;

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); }
    else setViewMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); }
    else setViewMonth((m) => m + 1);
  };

  const selectDate = (d: Date) => {
    onChange(fmtDate(d));
    setViewMode("day");
    setOpen(false);
  };

  const selectMonth = (month: number) => {
    setViewMonth(month);
    setViewMode("day");
  };

  const selectYear = (year: number) => {
    setViewYear(year);
    setViewMode("month");
  };

  const clearDate = () => {
    onChange("");
    setViewMode("day");
    setOpen(false);
  };

  const setNow = () => {
    const now = new Date();
    const candidate = maxDate && now > maxDate ? maxDate : now;
    onChange(fmtDate(candidate));
    setViewYear(candidate.getFullYear());
    setViewMonth(candidate.getMonth());
    setViewMode("day");
    setOpen(false);
  };

  const movePrev = () => {
    if (viewMode === "day") {
      prevMonth();
      return;
    }
    if (viewMode === "month") {
      setViewYear((y) => y - 1);
      return;
    }
    setViewYear((y) => y - 12);
  };

  const moveNext = () => {
    if (viewMode === "day") {
      nextMonth();
      return;
    }
    if (viewMode === "month") {
      setViewYear((y) => y + 1);
      return;
    }
    setViewYear((y) => y + 12);
  };

  // Display text
  const displayText = value
    ? formatDisplayDateFromDateOnly(value)
    : "Select date";

  const monthLabel = formatDisplayDateFromDateOnly(`${viewYear}-${pad(viewMonth + 1)}-01`);
  const yearGridStart = viewYear - 5;
  const yearGrid = Array.from({ length: 12 }, (_, i) => yearGridStart + i);

  const selectedStr = value || "";

  return (
    <div className="dp-wrapper" ref={wrapperRef}>
      <button
        type="button"
        className="dp-trigger"
        ref={triggerRef}
        onClick={() => {
          setOpen((prev) => !prev);
          setViewMode("day");
        }}
      >
        {displayText}
        <span className="dp-caret">▾</span>
      </button>

      {open && (
        <div
          className="dp-dropdown"
          ref={dropdownRef}
          style={{ position: "fixed", top: dropdownPos.top, left: dropdownPos.left }}
        >
          {/* Header */}
          <div className="dp-header">
            <button type="button" className="dp-nav" onClick={movePrev}>‹</button>
            <button
              type="button"
              className="dp-month-label dp-month-toggle"
              onClick={() => {
                if (viewMode === "day") setViewMode("month");
                else if (viewMode === "month") setViewMode("year");
                else setViewMode("day");
              }}
            >
              {viewMode === "day" ? monthLabel : viewMode === "month" ? String(viewYear) : `${yearGridStart} - ${yearGridStart + 11}`}
            </button>
            <button type="button" className="dp-nav" onClick={moveNext}>›</button>
          </div>

          {viewMode === "day" && (
            <>
              {/* Day labels */}
              <div className="dp-grid dp-day-labels">
                {DAY_LABELS.map((l) => (
                  <span key={l} className={`dp-day-label${l === "Sun" || l === "Sat" ? " dp-weekend-label" : ""}`}>{l}</span>
                ))}
              </div>

              {/* Calendar cells */}
              <div className="dp-grid">
                {cells.map(({ date: cellDate, inMonth }, idx) => {
                  const ds = fmtDate(cellDate);
                  const weekend = isWeekend(cellDate);
                  const holiday = holidayMap.get(ds);
                  const isSelected = ds === selectedStr;
                  const isToday = ds === fmtDate(new Date());
                  const isFuture = maxDate ? cellDate > maxDate : false;

                  let cls = "dp-cell";
                  if (!inMonth) cls += " dp-outside";
                  if (isFuture) cls += " dp-disabled";
                  if (isSelected) cls += " dp-selected";
                  if (isToday && !isSelected) cls += " dp-today";
                  if (holiday) cls += holiday.type === "regular" ? " dp-holiday-regular" : " dp-holiday-special";
                  else if (weekend && !isSelected) cls += " dp-weekend";

                  const title = holiday
                    ? `${holiday.name}${weekend ? " (Weekend)" : ""}`
                    : weekend
                      ? cellDate.getDay() === 0 ? "Sunday" : "Saturday"
                      : undefined;

                  return (
                    <button
                      key={idx}
                      type="button"
                      className={cls}
                      disabled={isFuture}
                      title={title}
                      onClick={() => selectDate(cellDate)}
                    >
                      {cellDate.getDate()}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {viewMode === "month" && (
            <div className="dp-month-grid">
              {MONTH_LABELS.map((m, idx) => {
                const monthStart = new Date(viewYear, idx, 1, 0, 0, 0, 0);
                const disabled = maxDate ? monthStart > maxDate : false;
                const active = idx === viewMonth;

                return (
                  <button
                    key={m}
                    type="button"
                    className={`dp-cell dp-month-cell${active ? " dp-selected" : ""}`}
                    disabled={disabled}
                    onClick={() => selectMonth(idx)}
                  >
                    {m.slice(0, 3)}
                  </button>
                );
              })}
            </div>
          )}

          {viewMode === "year" && (
            <div className="dp-month-grid">
              {yearGrid.map((year) => {
                const yearStart = new Date(year, 0, 1, 0, 0, 0, 0);
                const disabled = maxDate ? yearStart > maxDate : false;
                const active = year === viewYear;

                return (
                  <button
                    key={year}
                    type="button"
                    className={`dp-cell dp-month-cell${active ? " dp-selected" : ""}`}
                    disabled={disabled}
                    onClick={() => selectYear(year)}
                  >
                    {year}
                  </button>
                );
              })}
            </div>
          )}

          {/* Legend */}
          <div className="dp-legend">
            <span className="dp-legend-item"><span className="dp-swatch dp-swatch-weekend" /> Weekend</span>
            <span className="dp-legend-item"><span className="dp-swatch dp-swatch-regular" /> Regular Holiday</span>
            <span className="dp-legend-item"><span className="dp-swatch dp-swatch-special" /> Special Holiday</span>
          </div>

          <div className="dp-actions">
            <button type="button" className="btn btn-ghost" style={{ padding: "0.25rem 0.45rem", fontSize: "0.78rem" }} onClick={clearDate}>Clear</button>
            <button type="button" className="btn btn-outline" style={{ padding: "0.25rem 0.55rem", fontSize: "0.78rem" }} onClick={setNow}>Now</button>
          </div>
        </div>
      )}
    </div>
  );
}
