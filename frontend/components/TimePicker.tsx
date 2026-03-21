"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

function to24Hour(value12: string, meridiem: "AM" | "PM"): string | null {
  const match = value12.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 1 || hour > 12) return null;
  if (minute < 0 || minute > 59) return null;

  let normalizedHour = hour % 12;
  if (meridiem === "PM") normalizedHour += 12;

  return `${String(normalizedHour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function from24Hour(value: string): { text: string; meridiem: "AM" | "PM" } {
  const match = value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return { text: "", meridiem: "AM" };

  const hour24 = Number(match[1]);
  const minute = match[2];
  const meridiem: "AM" | "PM" = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;

  return { text: `${String(hour12).padStart(2, "0")}:${minute}`, meridiem };
}

function displayTime(value: string): string {
  const parsed = from24Hour(value);
  if (!parsed.text) return "";
  return `${parsed.text} ${parsed.meridiem}`;
}

function formatDigitsToTime(digitsOnly: string): string {
  const digits = digitsOnly.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

export default function TimePicker({ value, onChange, disabled = false, placeholder = "Select time" }: Props) {
  const [open, setOpen] = useState(false);
  const [draftTime, setDraftTime] = useState("");
  const [draftMeridiem, setDraftMeridiem] = useState<"AM" | "PM">("AM");
  const [error, setError] = useState("");

  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const syncFromValue = useCallback(() => {
    const parsed = from24Hour(value);
    setDraftTime(parsed.text);
    setDraftMeridiem(parsed.meridiem);
    setError("");
  }, [value]);

  useEffect(() => {
    syncFromValue();
  }, [syncFromValue]);

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

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const dropdownWidth = dropdownRef.current?.offsetWidth || 300;
    const viewportPadding = 8;
    const maxLeft = Math.max(viewportPadding, window.innerWidth - dropdownWidth - viewportPadding);
    const clampedLeft = Math.min(Math.max(rect.left, viewportPadding), maxLeft);
    setDropdownPos({ top: rect.bottom + 4, left: clampedLeft });
  }, []);

  useEffect(() => {
    if (!open) return;

    updatePosition();
    const raf = window.requestAnimationFrame(updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, updatePosition]);

  const canApply = useMemo(() => to24Hour(draftTime, draftMeridiem) !== null, [draftTime, draftMeridiem]);

  const apply = () => {
    const converted = to24Hour(draftTime, draftMeridiem);
    if (!converted) {
      setError("Enter a valid time in HH:MM (01:00 to 12:59).");
      return;
    }

    setError("");
    onChange(converted);
    setOpen(false);
  };

  const clear = () => {
    setDraftTime("");
    setError("");
    onChange("");
    setOpen(false);
  };

  const now = () => {
    const current = new Date();
    const hour24 = current.getHours();
    const minute = String(current.getMinutes()).padStart(2, "0");
    const meridiem: "AM" | "PM" = hour24 >= 12 ? "PM" : "AM";
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;

    setDraftTime(`${String(hour12).padStart(2, "0")}:${minute}`);
    setDraftMeridiem(meridiem);
    setError("");
  };

  const shown = value ? displayTime(value) : placeholder;
  const allowedControlKeys = [
    "Backspace",
    "Delete",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Tab",
    "Home",
    "End",
    "Enter",
  ];

  return (
    <div className="tp-wrapper" ref={wrapperRef}>
      <button
        type="button"
        className="tp-trigger"
        disabled={disabled}
        ref={triggerRef}
        onClick={() => {
          if (disabled) return;
          setOpen((prev) => !prev);
          syncFromValue();
        }}
      >
        <span className={value ? "" : "tp-placeholder"}>{shown}</span>
        <span className="tp-caret">▾</span>
      </button>

      {open && (
        <div
          className="tp-dropdown"
          ref={dropdownRef}
          style={{ position: "fixed", top: dropdownPos.top, left: dropdownPos.left }}
        >
          <div className="tp-input-row">
            <input
              className="tp-input"
              type="text"
              value={draftTime}
              onChange={(e) => {
                setDraftTime(formatDigitsToTime(e.target.value));
                if (error) setError("");
              }}
              onBeforeInput={(e) => {
                if (!e.data) return;
                if (!/^\d+$/.test(e.data)) {
                  e.preventDefault();
                }
              }}
              onKeyDown={(e) => {
                if (!allowedControlKeys.includes(e.key) && !/^\d$/.test(e.key)) {
                  e.preventDefault();
                  return;
                }
                if (e.key === "Enter") {
                  e.preventDefault();
                  apply();
                }
              }}
              onPaste={(e) => {
                e.preventDefault();
                const pasted = e.clipboardData.getData("text");
                setDraftTime(formatDigitsToTime(pasted));
                if (error) setError("");
              }}
              placeholder="00:00"
              inputMode="numeric"
              autoFocus
            />
            <select
              className="tp-select"
              value={draftMeridiem}
              onChange={(e) => {
                setDraftMeridiem(e.target.value as "AM" | "PM");
                if (error) setError("");
              }}
            >
              <option value="AM">AM</option>
              <option value="PM">PM</option>
            </select>
          </div>

          {error && <p className="tp-error">{error}</p>}

          <div className="tp-actions">
            <button type="button" className="btn btn-ghost" style={{ padding: "0.25rem 0.45rem", fontSize: "0.78rem" }} onClick={clear}>Clear</button>
            <div style={{ display: "flex", gap: "0.35rem" }}>
              <button type="button" className="btn btn-outline" style={{ padding: "0.25rem 0.55rem", fontSize: "0.78rem" }} onClick={now}>Now</button>
              <button type="button" className="btn btn-primary" style={{ padding: "0.25rem 0.55rem", fontSize: "0.78rem" }} onClick={apply} disabled={!canApply}>Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
