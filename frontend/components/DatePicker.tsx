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

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function DatePicker({ value, onChange, max }: Props) {
  const [open, setOpen] = useState(false);
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
    setDropdownPos({
      top: rect.bottom + 4,
      left: rect.left,
    });
  }, []);

  useEffect(() => {
    if (open) {
      updatePosition();
      window.addEventListener("scroll", updatePosition, true);
      window.addEventListener("resize", updatePosition);
      return () => {
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
    setOpen(false);
  };

  // Display text
  const displayText = value
    ? formatDisplayDateFromDateOnly(value)
    : "Select date";

  const monthLabel = formatDisplayDateFromDateOnly(`${viewYear}-${pad(viewMonth + 1)}-01`);

  const selectedStr = value || "";

  return (
    <div className="dp-wrapper" ref={wrapperRef}>
      <button
        type="button"
        className="dp-trigger"
        ref={triggerRef}
        onClick={() => setOpen(!open)}
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
            <button type="button" className="dp-nav" onClick={prevMonth}>‹</button>
            <span className="dp-month-label">{monthLabel}</span>
            <button type="button" className="dp-nav" onClick={nextMonth}>›</button>
          </div>

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

          {/* Legend */}
          <div className="dp-legend">
            <span className="dp-legend-item"><span className="dp-swatch dp-swatch-weekend" /> Weekend</span>
            <span className="dp-legend-item"><span className="dp-swatch dp-swatch-regular" /> Regular Holiday</span>
            <span className="dp-legend-item"><span className="dp-swatch dp-swatch-special" /> Special Holiday</span>
          </div>
        </div>
      )}
    </div>
  );
}
