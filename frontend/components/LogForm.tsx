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
    <div className="card" style={{ marginBottom: "1.5rem", position: "relative", overflow: "hidden" }}>
      {/* Accent bar for edit mode */}
      {isEditing && (
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "3px", background: "var(--primary)" }} />
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <div style={{
            width: "2rem", height: "2rem", borderRadius: "var(--radius-sm)",
            background: isEditing ? "var(--primary-light)" : "var(--success-light)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {isEditing ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            )}
          </div>
          <h3 style={{ fontSize: "1.05rem", fontWeight: 600 }}>
            {isEditing ? "Edit Log Entry" : "Add Log Entry"}
          </h3>
        </div>
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
                className={noLunch ? "badge badge-warning" : "badge badge-info"}
                style={{ cursor: "pointer", fontSize: "0.68rem", padding: "0.1rem 0.4rem", border: "none" }}
              >
                {noLunch ? "No Lunch" : "Has Lunch"}
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
          <div style={{
            display: "flex", gap: "1.5rem", margin: "0.65rem 0 0.25rem",
            fontSize: "0.82rem", color: "var(--text-muted)",
            padding: "0.5rem 0.75rem",
            background: "var(--primary-lighter)",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--primary-light)",
          }}>
            <span style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              Hours: <strong style={{ color: "var(--text)" }}>{previewHours.hoursWorked}</strong>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={previewHours.overtime > 0 ? "var(--primary)" : "var(--text-faint)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
              Overtime: <strong style={{ color: previewHours.overtime > 0 ? "var(--primary)" : "var(--text)" }}>{previewHours.overtime}</strong>
            </span>
          </div>
        )}

        {/* Offset section */}
        <div style={{
          background: "var(--bg-subtle)", borderRadius: "var(--radius-sm)",
          padding: "0.65rem 0.85rem", margin: "0.65rem 0 0.85rem",
          border: "1px solid var(--border)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem", cursor: "pointer", fontWeight: 500 }}>
              <input
                type="checkbox"
                checked={applyOffset}
                onChange={(e) => {
                  setApplyOffset(e.target.checked);
                  if (!e.target.checked) setOffsetAmount("");
                }}
                disabled={effectiveAvailable <= 0}
                style={{ width: "1rem", height: "1rem", accentColor: "var(--primary)" }}
              />
              Apply Offset
            </label>
            <span className="badge badge-info" style={{ fontSize: "0.74rem" }}>
              Available: {effectiveAvailable.toFixed(2)} hrs
            </span>
            {applyOffset && effectiveAvailable > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
                <label style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>Hours to apply:</label>
                <input
                  type="number"
                  step="0.25"
                  min="0"
                  max={effectiveAvailable}
                  value={offsetAmount}
                  onChange={(e) => setOffsetAmount(e.target.value)}
                  placeholder={`max ${effectiveAvailable}`}
                  style={{ width: "6rem", padding: "0.3rem 0.45rem", fontSize: "0.85rem" }}
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

        {error && (
          <div style={{
            padding: "0.6rem 0.85rem", borderRadius: "var(--radius-sm)",
            background: "var(--danger-light)", border: "1px solid var(--danger)",
            color: "var(--danger)", fontSize: "0.85rem", marginBottom: "0.65rem",
            display: "flex", alignItems: "center", gap: "0.4rem",
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            {error}
          </div>
        )}

        <button type="submit" className="btn btn-primary" disabled={loading} style={{ gap: "0.35rem" }}>
          {loading ? (
            "Saving\u2026"
          ) : isEditing ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              Update Log
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add Log
            </>
          )}
        </button>
      </form>
    </div>
  );
}