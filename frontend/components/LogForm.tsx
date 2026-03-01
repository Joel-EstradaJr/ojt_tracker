"use client";

// ============================================================
// LogForm — form to add a new or edit an existing time-log
// entry for a trainee. Includes lunch break fields, "Now"
// buttons, "No Lunch" toggle, and overtime/offset controls.
// ============================================================

import { useState, useEffect, useCallback } from "react";
import { createLog, updateLog, fetchOffset } from "@/lib/api";
import { LogEntry } from "@/types";
import DatePicker from "@/components/DatePicker";
import { sanitizeInput, validateAccomplishment } from "@/lib/sanitize";

interface Props {
  traineeId: string;
  onCreated: () => void;
  /** When provided, the form is in edit mode — fields pre-filled */
  editingLog?: LogEntry | null;
  /** Called when user cancels editing */
  onCancelEdit?: () => void;
  /** Available offset passed from parent (kept in sync after each load) */
  availableOffset?: number;
}

/** Extract HH:mm from an ISO date string in local TZ */
function isoToTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Extract yyyy-MM-dd from an ISO date string */
function isoToDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA"); // en-CA gives yyyy-MM-dd
}

/** Detect if a log had "no lunch" (lunchStart === lunchEnd) */
function isNoLunch(log: LogEntry): boolean {
  return new Date(log.lunchStart).getTime() === new Date(log.lunchEnd).getTime();
}

const STANDARD_HOURS = 8;

export default function LogForm({ traineeId, onCreated, editingLog, onCancelEdit, availableOffset: parentOffset }: Props) {
  const today = new Date().toISOString().slice(0, 10);

  const [date, setDate] = useState(today);
  const [timeIn, setTimeIn] = useState("08:00");
  const [lunchStart, setLunchStart] = useState("12:00");
  const [lunchEnd, setLunchEnd] = useState("13:00");
  const [noLunch, setNoLunch] = useState(false);
  const [timeOut, setTimeOut] = useState("17:00");
  const [accomplishment, setAccomplishment] = useState("");

  // Offset controls
  const [applyOffset, setApplyOffset] = useState(false);
  const [offsetAmount, setOffsetAmount] = useState("");
  const [availableOffset, setAvailableOffset] = useState(parentOffset ?? 0);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Keep in sync with parent prop
  useEffect(() => {
    if (parentOffset !== undefined) setAvailableOffset(parentOffset);
  }, [parentOffset]);

  // Refresh available offset when entering edit mode (exclude self)
  const refreshOffset = useCallback(async () => {
    try {
      const res = await fetchOffset(traineeId);
      // In edit mode the server's getAvailableOffset doesn't exclude the
      // current log — but the update endpoint does, so we just show the
      // "bank" here and let the server cap it correctly.
      setAvailableOffset(res.availableOffset);
    } catch { /* silent */ }
  }, [traineeId]);

  // Compute a preview of hours based on current field values
  const previewHours = (() => {
    if (!timeIn || !timeOut || !date) return null;
    try {
      const tIn = new Date(`${date}T${timeIn}:00`).getTime();
      const tOut = new Date(`${date}T${timeOut}:00`).getTime();
      const lS = noLunch ? tIn : new Date(`${date}T${lunchStart}:00`).getTime();
      const lE = noLunch ? tIn : new Date(`${date}T${lunchEnd}:00`).getTime();
      const mins = (tOut - tIn) / 60000 - (lE - lS) / 60000;
      if (mins < 0) return null;
      const hw = parseFloat((mins / 60).toFixed(2));
      const ot = parseFloat(Math.max(0, hw - STANDARD_HOURS).toFixed(2));
      return { hoursWorked: hw, overtime: ot };
    } catch { return null; }
  })();

  // When editingLog changes, populate all fields
  useEffect(() => {
    if (editingLog) {
      setDate(isoToDate(editingLog.date));
      setTimeIn(isoToTime(editingLog.timeIn));
      setTimeOut(isoToTime(editingLog.timeOut));
      setAccomplishment(editingLog.accomplishment);
      const nl = isNoLunch(editingLog);
      setNoLunch(nl);
      if (nl) {
        setLunchStart("12:00");
        setLunchEnd("13:00");
      } else {
        setLunchStart(isoToTime(editingLog.lunchStart));
        setLunchEnd(isoToTime(editingLog.lunchEnd));
      }
      // Restore offset state from the log being edited
      if (editingLog.offsetUsed > 0) {
        setApplyOffset(true);
        setOffsetAmount(String(editingLog.offsetUsed));
      } else {
        setApplyOffset(false);
        setOffsetAmount("");
      }
      setError("");
      refreshOffset();
    } else {
      // Reset to defaults when switching back to create mode
      setDate(today);
      setTimeIn("08:00");
      setLunchStart("12:00");
      setLunchEnd("13:00");
      setNoLunch(false);
      setTimeOut("17:00");
      setAccomplishment("");
      setApplyOffset(false);
      setOffsetAmount("");
      setError("");
    }
  }, [editingLog, today, refreshOffset]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!date || !timeIn || !timeOut || !accomplishment.trim()) {
      setError("Date, Time In, Time Out, and Accomplishment are required.");
      return;
    }
    const accErr = validateAccomplishment(accomplishment);
    if (accErr) { setError(accErr); return; }
    if (date > today) {
      setError("Date cannot be in the future.");
      return;
    }
    if (!noLunch && (!lunchStart || !lunchEnd)) {
      setError("Lunch Start and Lunch End are required (or toggle No Lunch).");
      return;
    }

    // Combine date + time into ISO strings
    const timeInISO = new Date(`${date}T${timeIn}:00`).toISOString();
    const timeOutISO = new Date(`${date}T${timeOut}:00`).toISOString();
    const lunchStartISO = noLunch ? timeInISO : new Date(`${date}T${lunchStart}:00`).toISOString();
    const lunchEndISO = noLunch ? timeInISO : new Date(`${date}T${lunchEnd}:00`).toISOString();

    const offsetPayload = applyOffset
      ? { applyOffset: true, offsetAmount: offsetAmount ? parseFloat(offsetAmount) : undefined }
      : {};

    setLoading(true);
    try {
      if (editingLog) {
        await updateLog(editingLog.id, {
          date: new Date(date).toISOString(),
          timeIn: timeInISO,
          lunchStart: lunchStartISO,
          lunchEnd: lunchEndISO,
          timeOut: timeOutISO,
          accomplishment,
          ...offsetPayload,
        });
      } else {
        await createLog({
          traineeId,
          date: new Date(date).toISOString(),
          timeIn: timeInISO,
          lunchStart: lunchStartISO,
          lunchEnd: lunchEndISO,
          timeOut: timeOutISO,
          accomplishment,
          ...offsetPayload,
        });
      }
      // Reset form to defaults and notify parent
      setDate(today);
      setTimeIn("08:00");
      setLunchStart("12:00");
      setLunchEnd("13:00");
      setNoLunch(false);
      setTimeOut("17:00");
      setAccomplishment("");
      setApplyOffset(false);
      setOffsetAmount("");
      setError("");
      onCreated();
      if (editingLog && onCancelEdit) onCancelEdit();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : `Failed to ${editingLog ? "update" : "create"} log.`);
    } finally {
      setLoading(false);
    }
  };

  const isEditing = !!editingLog;

  // In edit mode, the effective available offset = server bank + what THIS log already used
  const effectiveAvailable = isEditing && editingLog
    ? parseFloat((availableOffset + editingLog.offsetUsed).toFixed(2))
    : availableOffset;

  return (
    <div className="card" style={{ marginBottom: "1.5rem", border: isEditing ? "2px solid var(--primary)" : undefined }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <h3>{isEditing ? "Edit Log Entry" : "Add Log Entry"}</h3>
        {isEditing && onCancelEdit && (
          <button type="button" className="btn btn-outline" style={{ fontSize: "0.8rem", padding: "0.3rem 0.7rem" }} onClick={onCancelEdit}>
            Cancel Edit
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem" }}>
          <div className="form-group">
            <label>Date</label>
            <DatePicker value={date} onChange={setDate} max={today} />
          </div>

          <div className="form-group">
            <label>Time In</label>
            <div style={{ display: "flex", gap: "0.35rem" }}>
              <input type="time" value={timeIn} onChange={(e) => setTimeIn(e.target.value)} style={{ flex: 1 }} />
              <button type="button" className="btn btn-outline" style={{ padding: "0.3rem 0.5rem", fontSize: "0.75rem", whiteSpace: "nowrap" }} onClick={() => { const n = new Date(); setTimeIn(`${String(n.getHours()).padStart(2,"0")}:${String(n.getMinutes()).padStart(2,"0")}`); }}>
                Now
              </button>
            </div>
          </div>

          <div className="form-group">
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              Lunch Start
              <button
                type="button"
                onClick={() => setNoLunch(!noLunch)}
                style={{
                  fontSize: "0.72rem",
                  padding: "0.15rem 0.45rem",
                  borderRadius: "4px",
                  border: `1px solid ${noLunch ? "var(--danger)" : "var(--border)"}`,
                  background: noLunch ? "var(--danger)" : "transparent",
                  color: noLunch ? "#fff" : "var(--text-muted)",
                  cursor: "pointer",
                  lineHeight: 1.4,
                }}
              >
                No Lunch
              </button>
            </label>
            <input type="time" value={lunchStart} onChange={(e) => setLunchStart(e.target.value)} disabled={noLunch} style={{ opacity: noLunch ? 0.4 : 1 }} />
          </div>

          <div className="form-group">
            <label>Lunch End</label>
            <input type="time" value={lunchEnd} onChange={(e) => setLunchEnd(e.target.value)} disabled={noLunch} style={{ opacity: noLunch ? 0.4 : 1 }} />
          </div>

          <div className="form-group">
            <label>Time Out</label>
            <div style={{ display: "flex", gap: "0.35rem" }}>
              <input type="time" value={timeOut} onChange={(e) => setTimeOut(e.target.value)} style={{ flex: 1 }} />
              <button type="button" className="btn btn-outline" style={{ padding: "0.3rem 0.5rem", fontSize: "0.75rem", whiteSpace: "nowrap" }} onClick={() => { const n = new Date(); setTimeOut(`${String(n.getHours()).padStart(2,"0")}:${String(n.getMinutes()).padStart(2,"0")}`); }}>
                Now
              </button>
            </div>
          </div>
        </div>

        {/* Preview: calculated hours & overtime */}
        {previewHours && (
          <div style={{ display: "flex", gap: "1.5rem", margin: "0.5rem 0 0.25rem", fontSize: "0.82rem", color: "var(--text-muted)" }}>
            <span>Hours: <strong style={{ color: "var(--text)" }}>{previewHours.hoursWorked}</strong></span>
            <span>Overtime: <strong style={{ color: previewHours.overtime > 0 ? "var(--primary)" : "var(--text)" }}>{previewHours.overtime}</strong></span>
          </div>
        )}

        {/* Offset section */}
        <div style={{ background: "var(--bg)", borderRadius: "6px", padding: "0.6rem 0.75rem", margin: "0.5rem 0 0.75rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.85rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={applyOffset}
                onChange={(e) => {
                  setApplyOffset(e.target.checked);
                  if (!e.target.checked) setOffsetAmount("");
                }}
                disabled={effectiveAvailable <= 0}
              />
              Apply Offset
            </label>
            <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
              Available: <strong>{effectiveAvailable.toFixed(2)}</strong> hrs
            </span>
            {applyOffset && effectiveAvailable > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                <label style={{ fontSize: "0.82rem" }}>Hours to apply:</label>
                <input
                  type="number"
                  step="0.25"
                  min="0"
                  max={effectiveAvailable}
                  value={offsetAmount}
                  onChange={(e) => setOffsetAmount(e.target.value)}
                  placeholder={`max ${effectiveAvailable}`}
                  style={{ width: "6rem", padding: "0.25rem 0.4rem", fontSize: "0.85rem" }}
                />
              </div>
            )}
          </div>
        </div>

        <div className="form-group">
          <label>Accomplishment *</label>
          <textarea
            rows={3}
            value={accomplishment}
            onChange={(e) => setAccomplishment(sanitizeInput(e.target.value))}
            placeholder="What did you accomplish today?"
          />
        </div>

        {error && <p style={{ color: "var(--danger)", marginBottom: "0.5rem", fontSize: "0.85rem" }}>{error}</p>}

        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? "Saving…" : isEditing ? "Update Log" : "Add Log"}
        </button>
      </form>
    </div>
  );
}
