"use client";

// ============================================================
// LogForm — form to add a new or edit an existing time-log
// entry for a trainee. Includes lunch break fields, "Now"
// buttons, and "No Lunch" toggle.
// ============================================================

import { useState, useEffect } from "react";
import { createLog, updateLog } from "@/lib/api";
import { LogEntry } from "@/types";

interface Props {
  traineeId: string;
  onCreated: () => void;
  /** When provided, the form is in edit mode — fields pre-filled */
  editingLog?: LogEntry | null;
  /** Called when user cancels editing */
  onCancelEdit?: () => void;
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

export default function LogForm({ traineeId, onCreated, editingLog, onCancelEdit }: Props) {
  const today = new Date().toISOString().slice(0, 10);

  const [date, setDate] = useState(today);
  const [timeIn, setTimeIn] = useState("08:00");
  const [lunchStart, setLunchStart] = useState("12:00");
  const [lunchEnd, setLunchEnd] = useState("13:00");
  const [noLunch, setNoLunch] = useState(false);
  const [timeOut, setTimeOut] = useState("17:00");
  const [accomplishment, setAccomplishment] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
      setError("");
    } else {
      // Reset to defaults when switching back to create mode
      setDate(today);
      setTimeIn("08:00");
      setLunchStart("12:00");
      setLunchEnd("13:00");
      setNoLunch(false);
      setTimeOut("17:00");
      setAccomplishment("");
      setError("");
    }
  }, [editingLog, today]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!date || !timeIn || !timeOut || !accomplishment.trim()) {
      setError("Date, Time In, Time Out, and Accomplishment are required.");
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

    setLoading(true);
    try {
      if (editingLog) {
        // ── Update existing log ──────────────────
        await updateLog(editingLog.id, {
          date: new Date(date).toISOString(),
          timeIn: timeInISO,
          lunchStart: lunchStartISO,
          lunchEnd: lunchEndISO,
          timeOut: timeOutISO,
          accomplishment,
        });
      } else {
        // ── Create new log ───────────────────────
        await createLog({
          traineeId,
          date: new Date(date).toISOString(),
          timeIn: timeInISO,
          lunchStart: lunchStartISO,
          lunchEnd: lunchEndISO,
          timeOut: timeOutISO,
          accomplishment,
        });
      }
      // After success, reset form and notify parent
      setAccomplishment("");
      onCreated();
      if (editingLog && onCancelEdit) onCancelEdit(); // exit edit mode
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : `Failed to ${editingLog ? "update" : "create"} log.`);
    } finally {
      setLoading(false);
    }
  };

  const isEditing = !!editingLog;

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
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
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
                {noLunch ? "No Lunch" : "No Lunch"}
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

        <div className="form-group">
          <label>Accomplishment *</label>
          <textarea
            rows={3}
            value={accomplishment}
            onChange={(e) => setAccomplishment(e.target.value)}
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
