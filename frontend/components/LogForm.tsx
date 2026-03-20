"use client";

// ============================================================
// LogForm — dual-mode time logging component:
// • Admin: traditional form with full date/time pickers
// • Trainee: sequential button flow (Time In → Lunch Start → Lunch End → Time Out)
// ============================================================

import { useState, useEffect, useCallback } from "react";
import {
  createLog,
  updateLog,
  fetchOffset,
  patchLogAction,
  fetchAccomplishmentScripts,
  createAccomplishmentScript,
  updateAccomplishmentScript,
} from "@/lib/api";
import { AccomplishmentScript, LogEntry } from "@/types";
import DatePicker from "@/components/DatePicker";
import RightSidebarDrawer from "@/components/RightSidebarDrawer";
import { sanitizeInput } from "@/lib/sanitize";
import { formatMinutes } from "@/lib/duration";
import { useActionGuard } from "@/lib/useActionGuard";
import { formatDisplayDate, formatDisplayDateFromDateOnly, toDateInputValue } from "@/lib/date";

interface Props {
  traineeId: string;
  traineeDisplayName?: string;
  onCreated: () => void;
  /** When provided, the form is in edit mode — fields pre-filled */
  editingLog?: LogEntry | null;
  /** Called when user cancels editing */
  onCancelEdit?: () => void;
  /** Available offset passed from parent */
  availableOffset?: number;
  /** Viewer role: admin sees full form, trainee sees button flow */
  viewerRole?: "admin" | "trainee" | null;
  /** All logs for today detection */
  logs?: LogEntry[];
}

/** Extract HH:mm from an ISO date string in local TZ */
function isoToTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Extract yyyy-MM-dd from an ISO date string */
function isoToDate(iso: string): string {
  return toDateInputValue(iso);
}

/** Detect if a log had "no lunch" (lunchStart === lunchEnd) */
function isNoLunch(log: LogEntry): boolean {
  return new Date(log.lunchStart).getTime() === new Date(log.lunchEnd).getTime();
}

/** Format time for display */
function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
}

type ActionStep = "timeIn" | "lunchStart" | "lunchEnd" | "timeOut" | "done";

function getNextAction(log: LogEntry | null): ActionStep {
  if (!log) return "timeIn";
  // If timeOut already recorded, all done
  if (log.timeOut) return "done";
  // If lunchEnd recorded (not placeholder), next is timeOut
  if (log.lunchEnd && new Date(log.lunchEnd).getTime() !== new Date(log.timeIn).getTime()) return "timeOut";
  // If lunchStart recorded (not placeholder), next is lunchEnd
  if (log.lunchStart && new Date(log.lunchStart).getTime() !== new Date(log.timeIn).getTime()) return "lunchEnd";
  // TimeIn done, next is lunchStart
  return "lunchStart";
}

const ACTION_LABELS: Record<ActionStep, string> = {
  timeIn: "Time In",
  lunchStart: "Lunch Start",
  lunchEnd: "Lunch End",
  timeOut: "Time Out",
  done: "Complete",
};

const ACTION_ICONS: Record<ActionStep, string> = {
  timeIn: "🕐",
  lunchStart: "🍽️",
  lunchEnd: "🍽️",
  timeOut: "🕔",
  done: "✅",
};

const STANDARD_MINUTES = 8 * 60;

export default function LogForm({
  traineeId, traineeDisplayName, onCreated, editingLog, onCancelEdit,
  availableOffset: parentOffset, viewerRole, logs,
}: Props) {
  const { runGuarded } = useActionGuard();
  const today = new Date().toISOString().slice(0, 10);
  const isAdmin = viewerRole === "admin";

  // ── Admin form state ─────────────────────────────────────────
  const [date, setDate] = useState(today);
  const [timeIn, setTimeIn] = useState("");
  const [lunchStart, setLunchStart] = useState("");
  const [lunchEnd, setLunchEnd] = useState("");
  const [noLunch, setNoLunch] = useState(false);
  const [timeOut, setTimeOut] = useState("");
  const [accomplishment, setAccomplishment] = useState("");
  const [applyOffset, setApplyOffset] = useState(false);
  const [offsetAmount, setOffsetAmount] = useState("");
  const [availableOffset, setAvailableOffset] = useState(parentOffset ?? 0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // ── Trainee button flow state ───────────────────────────────
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingAction, setPendingAction] = useState<ActionStep | null>(null);
  const [capturedTime, setCapturedTime] = useState<Date | null>(null);
  const [todayLog, setTodayLog] = useState<LogEntry | null>(null);
  const [showAccomplishmentModal, setShowAccomplishmentModal] = useState(false);
  const [accomplishmentTargetLogId, setAccomplishmentTargetLogId] = useState<string | null>(null);
  const [accomplishmentText, setAccomplishmentText] = useState("");
  const [showScriptsPanel, setShowScriptsPanel] = useState(false);
  const [scriptsLoading, setScriptsLoading] = useState(false);
  const [scriptsError, setScriptsError] = useState("");
  const [scripts, setScripts] = useState<AccomplishmentScript[]>([]);
  const [scriptMode, setScriptMode] = useState<"list" | "create" | "edit">("list");
  const [editingScriptId, setEditingScriptId] = useState<string | null>(null);
  const [scriptTitle, setScriptTitle] = useState("");
  const [scriptContent, setScriptContent] = useState("");

  // Find today's log from passed logs
  useEffect(() => {
    if (logs) {
      const todayEntry = logs.find((l) => {
        const logDate = new Date(l.date).toISOString().slice(0, 10);
        return logDate === today;
      });
      setTodayLog(todayEntry || null);
    }
  }, [logs, today]);

  // Keep offset in sync with parent prop
  useEffect(() => {
    if (parentOffset !== undefined) setAvailableOffset(parentOffset);
  }, [parentOffset]);

  // Refresh available offset when entering edit mode
  const refreshOffset = useCallback(async () => {
    try {
      const res = await fetchOffset(traineeId);
      setAvailableOffset(res.availableOffset);
    } catch { /* silent */ }
  }, [traineeId]);

  const loadScripts = useCallback(async () => {
    setScriptsLoading(true);
    setScriptsError("");
    try {
      const data = await fetchAccomplishmentScripts(traineeId);
      setScripts(data);
    } catch (err: unknown) {
      setScriptsError(err instanceof Error ? err.message : "Failed to load scripts.");
    } finally {
      setScriptsLoading(false);
    }
  }, [traineeId]);

  useEffect(() => {
    if (!showAccomplishmentModal) return;
    loadScripts();
  }, [showAccomplishmentModal, loadScripts]);

  useEffect(() => {
    if (!showAccomplishmentModal) {
      setShowScriptsPanel(false);
      setScriptMode("list");
      setEditingScriptId(null);
      setScriptTitle("");
      setScriptContent("");
      setScriptsError("");
    }
  }, [showAccomplishmentModal]);

  // Compute preview hours (admin form)
  const previewHours = (() => {
    if (!timeIn || !timeOut || !date) return null;
    try {
      const tIn = new Date(`${date}T${timeIn}:00`).getTime();
      const tOut = new Date(`${date}T${timeOut}:00`).getTime();
      const hasLunchWindow = !noLunch && Boolean(lunchStart) && Boolean(lunchEnd);
      const lS = hasLunchWindow ? new Date(`${date}T${lunchStart}:00`).getTime() : tIn;
      const lE = hasLunchWindow ? new Date(`${date}T${lunchEnd}:00`).getTime() : tIn;
      const lunchDeduction = hasLunchWindow ? Math.max(0, (lE - lS) / 60000) : 0;
      const mins = (tOut - tIn) / 60000 - lunchDeduction;
      if (mins < 0) return null;
      const hw = Math.floor(mins);
      const ot = Math.max(0, hw - STANDARD_MINUTES);
      return { hoursWorked: hw, overtime: ot };
    } catch { return null; }
  })();

  const offsetBlockedByOvertime = Boolean(previewHours && previewHours.overtime > 0);

  useEffect(() => {
    if (offsetBlockedByOvertime && applyOffset) {
      setApplyOffset(false);
      setOffsetAmount("");
    }
  }, [offsetBlockedByOvertime, applyOffset]);

  // When editingLog changes, populate all fields (admin edit mode)
  useEffect(() => {
    if (editingLog) {
      setDate(isoToDate(editingLog.date));
      setTimeIn(isoToTime(editingLog.timeIn));
      setTimeOut(editingLog.timeOut ? isoToTime(editingLog.timeOut) : "");
      setAccomplishment(editingLog.accomplishment || "");
      const nl = isNoLunch(editingLog);
      setNoLunch(nl);
      if (nl) { setLunchStart(""); setLunchEnd(""); }
      else { setLunchStart(isoToTime(editingLog.lunchStart)); setLunchEnd(isoToTime(editingLog.lunchEnd)); }
      if (editingLog.offsetUsed > 0) { setApplyOffset(true); setOffsetAmount(String(editingLog.offsetUsed)); }
      else { setApplyOffset(false); setOffsetAmount(""); }
      setError("");
      refreshOffset();
    } else {
      setDate(today); setTimeIn(""); setLunchStart(""); setLunchEnd(""); setNoLunch(false);
      setTimeOut(""); setAccomplishment(""); setApplyOffset(false); setOffsetAmount(""); setError("");
    }
  }, [editingLog, today, refreshOffset]);

  // ── Admin form submit ──────────────────────────────────────
  const handleAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await runGuarded("log-admin-submit", async () => {
      setError("");

      if (!date || !timeIn) { setError("Date and Time In are required."); return; }
      if (date > today) { setError("Date cannot be in the future."); return; }

      const timeInISO = new Date(`${date}T${timeIn}:00`).toISOString();
      const timeOutISO = timeOut ? new Date(`${date}T${timeOut}:00`).toISOString() : undefined;
      const lunchStartISO = noLunch || !lunchStart ? undefined : new Date(`${date}T${lunchStart}:00`).toISOString();
      const lunchEndISO = noLunch || !lunchEnd ? undefined : new Date(`${date}T${lunchEnd}:00`).toISOString();

      if (timeOut) {
        if (!noLunch && (!lunchStart || !lunchEnd)) { setError("Lunch Start and Lunch End are required (or toggle No Lunch)."); return; }
      }

      if (applyOffset && offsetBlockedByOvertime) {
        setError("Offset can only be applied when overtime is 0.");
        return;
      }

      const offsetPayload = applyOffset
        ? { applyOffset: true, offsetAmount: offsetAmount ? Math.floor(Number(offsetAmount)) : undefined }
        : {};

      setLoading(true);
      try {
        if (editingLog) {
          if (isAdmin) {
            await updateLog(editingLog.id, {
              date: new Date(date).toISOString(),
              timeIn: timeInISO,
              lunchStart: noLunch ? timeInISO : lunchStartISO,
              lunchEnd: noLunch ? timeInISO : lunchEndISO,
              timeOut: timeOutISO,
              accomplishment: accomplishment || undefined,
              ...offsetPayload,
            });
          } else {
            await updateLog(editingLog.id, {
              accomplishment: accomplishment || undefined,
              ...offsetPayload,
            });
          }
        } else {
          await createLog({
            traineeId,
            date: new Date(date).toISOString(),
            timeIn: timeInISO,
            lunchStart: noLunch ? timeInISO : lunchStartISO,
            lunchEnd: noLunch ? timeInISO : lunchEndISO,
            timeOut: timeOutISO,
            accomplishment: accomplishment || undefined,
            ...offsetPayload,
          });
        }
        setDate(today); setTimeIn(""); setLunchStart(""); setLunchEnd("");
        setNoLunch(false); setTimeOut(""); setAccomplishment("");
        setApplyOffset(false); setOffsetAmount(""); setError("");
        onCreated();
        if (editingLog && onCancelEdit) onCancelEdit();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : `Failed to ${editingLog ? "update" : "create"} log.`);
      } finally { setLoading(false); }
    });
  };

  // ── Trainee button handlers ────────────────────────────────
  const handleTraineeAction = (action: ActionStep) => {
    setCapturedTime(new Date());
    setPendingAction(action);
    setShowConfirm(true);
  };

  const confirmTraineeAction = async () => {
    await runGuarded("log-trainee-action", async () => {
      if (!pendingAction || !capturedTime) return;
      setShowConfirm(false);
      setLoading(true);
      setError("");

      try {
        if (pendingAction === "timeIn") {
          await createLog({
            traineeId,
            date: new Date().toISOString(),
            timeIn: capturedTime.toISOString(),
          });
        } else if (todayLog) {
          const updated = await patchLogAction(todayLog.id, {
            action: pendingAction as "lunchStart" | "lunchEnd" | "timeOut",
            timestamp: capturedTime.toISOString(),
          });
          if (pendingAction === "timeOut") {
            setAccomplishmentTargetLogId(updated.id);
            setAccomplishmentText(updated.accomplishment ?? "");
            setShowAccomplishmentModal(true);
          }
        }
        onCreated();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to record action.");
      } finally {
        setLoading(false);
        setPendingAction(null);
        setCapturedTime(null);
      }
    });
  };

  const handleSaveAccomplishment = async () => {
    await runGuarded("log-save-accomplishment", async () => {
      if (!accomplishmentTargetLogId || !accomplishmentText.trim()) return;
      setLoading(true);
      setError("");
      try {
        await patchLogAction(accomplishmentTargetLogId, { action: "accomplishment", accomplishment: accomplishmentText });
        setShowAccomplishmentModal(false);
        setAccomplishmentTargetLogId(null);
        setAccomplishmentText("");
        onCreated();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to save accomplishment.");
      } finally { setLoading(false); }
    });
  };

  const handleUseScript = (content: string) => {
    setAccomplishmentText((prev) => (prev.trim() ? `${prev.trim()}\n\n${content.trim()}` : content.trim()));
    setShowScriptsPanel(false);
    setScriptMode("list");
  };

  const handleStartCreateScript = () => {
    setScriptMode("create");
    setEditingScriptId(null);
    setScriptTitle("");
    setScriptContent("");
    setScriptsError("");
  };

  const handleStartEditScript = (script: AccomplishmentScript) => {
    setScriptMode("edit");
    setEditingScriptId(script.id);
    setScriptTitle(script.title);
    setScriptContent(script.content);
    setScriptsError("");
  };

  const handleSaveScript = async () => {
    const title = sanitizeInput(scriptTitle).trim();
    const content = sanitizeInput(scriptContent).trim();
    if (!title || !content) {
      setScriptsError("Title and content are required.");
      return;
    }

    setScriptsLoading(true);
    setScriptsError("");
    try {
      if (scriptMode === "edit" && editingScriptId) {
        const updated = await updateAccomplishmentScript(editingScriptId, { title, content });
        setScripts((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      } else {
        const created = await createAccomplishmentScript(traineeId, { title, content });
        setScripts((prev) => [created, ...prev]);
      }
      setScriptMode("list");
      setEditingScriptId(null);
      setScriptTitle("");
      setScriptContent("");
    } catch (err: unknown) {
      setScriptsError(err instanceof Error ? err.message : "Failed to save script.");
    } finally {
      setScriptsLoading(false);
    }
  };

  const isEditing = !!editingLog;
  const lockCoreFields = isEditing && !isAdmin;
  const effectiveAvailable = isEditing && editingLog
    ? Math.max(0, Math.floor(availableOffset + editingLog.offsetUsed))
    : availableOffset;
  const previewMetrics = previewHours ?? { hoursWorked: 0, overtime: 0 };

  // ════════════════════════════════════════════════════════════
  // TRAINEE BUTTON FLOW RENDER
  // ════════════════════════════════════════════════════════════
  if (!isAdmin && !isEditing) {
    const nextAction = getNextAction(todayLog);
    const allDone = nextAction === "done";

    return (
      <div className="card" style={{ marginBottom: "1.5rem", position: "relative", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.75rem" }}>
          <div style={{
            width: "2rem", height: "2rem", borderRadius: "var(--radius-sm)",
            background: allDone ? "var(--success-light)" : "var(--primary-light)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem",
          }}>
            {allDone ? "✅" : "🕐"}
          </div>
          <h3 style={{ fontSize: "1.05rem", fontWeight: 600 }}>
            {allDone ? "Today\u2019s Log Complete" : "Time Logging"}
          </h3>
          <span style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginLeft: "auto" }}>
            {formatDisplayDate(new Date())}
          </span>
        </div>

        {/* Timeline of completed steps */}
        {todayLog && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", padding: "0.35rem 0.65rem", borderRadius: "var(--radius-sm)", background: "var(--success-light)", border: "1px solid var(--success)", fontSize: "0.82rem" }}>
              🕐 Time In: <strong>{formatTime(todayLog.timeIn)}</strong>
            </div>
            {new Date(todayLog.lunchStart).getTime() !== new Date(todayLog.timeIn).getTime() && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", padding: "0.35rem 0.65rem", borderRadius: "var(--radius-sm)", background: "var(--success-light)", border: "1px solid var(--success)", fontSize: "0.82rem" }}>
                🍽️ Lunch Start: <strong>{formatTime(todayLog.lunchStart)}</strong>
              </div>
            )}
            {new Date(todayLog.lunchEnd).getTime() !== new Date(todayLog.timeIn).getTime() && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", padding: "0.35rem 0.65rem", borderRadius: "var(--radius-sm)", background: "var(--success-light)", border: "1px solid var(--success)", fontSize: "0.82rem" }}>
                🍽️ Lunch End: <strong>{formatTime(todayLog.lunchEnd)}</strong>
              </div>
            )}
            {todayLog.timeOut && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.3rem", padding: "0.35rem 0.65rem", borderRadius: "var(--radius-sm)", background: "var(--success-light)", border: "1px solid var(--success)", fontSize: "0.82rem" }}>
                🕔 Time Out: <strong>{formatTime(todayLog.timeOut)}</strong>
              </div>
            )}
          </div>
        )}

        {/* Hours summary when complete */}
        {allDone && todayLog && (
          <div style={{
            display: "flex", gap: "1.5rem", margin: "0 0 0.65rem",
            fontSize: "0.82rem", color: "var(--text-muted)",
            padding: "0.5rem 0.75rem",
            background: "var(--primary-lighter)",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--primary-light)",
          }}>
            <span>Hours: <strong style={{ color: "var(--text)" }}>{formatMinutes(todayLog.hoursWorked)}</strong></span>
            <span>Overtime: <strong style={{ color: todayLog.overtime > 0 ? "var(--primary)" : "var(--text)" }}>{formatMinutes(todayLog.overtime)}</strong></span>
          </div>
        )}

        {/* Next action button */}
        {!allDone && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={loading}
            onClick={() => handleTraineeAction(nextAction)}
            style={{ gap: "0.5rem", fontSize: "1rem", padding: "0.75rem 1.5rem", width: "100%" }}
          >
            <span style={{ fontSize: "1.1rem" }}>{ACTION_ICONS[nextAction]}</span>
            {loading ? "Recording\u2026" : ACTION_LABELS[nextAction]}
          </button>
        )}

        {/* Accomplishment display only; entry is handled in required modal after Time Out */}
        {todayLog && (
          <div style={{ marginTop: "0.65rem" }}>
            {todayLog.accomplishment ? (
              <div style={{ fontSize: "0.85rem", padding: "0.5rem 0.75rem", background: "var(--bg-subtle)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}>
                <span style={{ fontWeight: 600, fontSize: "0.78rem", color: "var(--text-muted)", display: "block", marginBottom: "0.25rem" }}>Accomplishment</span>
                {todayLog.accomplishment}
              </div>
            ) : (
              <span style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>No accomplishment submitted yet.</span>
            )}
          </div>
        )}

        {error && (
          <div style={{ padding: "0.6rem 0.85rem", borderRadius: "var(--radius-sm)", background: "var(--danger-light)", border: "1px solid var(--danger)", color: "var(--danger)", fontSize: "0.85rem", marginTop: "0.65rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
            {error}
          </div>
        )}

        {/* Confirmation Modal */}
        {showConfirm && pendingAction && capturedTime && (
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
            <div style={{ background: "var(--bg)", borderRadius: "var(--radius)", padding: "1.5rem", maxWidth: 400, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "1.3rem" }}>{ACTION_ICONS[pendingAction]}</span>
                Confirm {ACTION_LABELS[pendingAction]}
              </h3>
              <div style={{ fontSize: "0.9rem", display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1.25rem" }}>
                {traineeDisplayName && (
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-muted)" }}>Name:</span>
                    <strong>{traineeDisplayName}</strong>
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--text-muted)" }}>Date:</span>
                  <strong>{formatDisplayDate(capturedTime)}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--text-muted)" }}>Action:</span>
                  <strong>{ACTION_LABELS[pendingAction]}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "var(--text-muted)" }}>Time:</span>
                  <strong>{capturedTime.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true })}</strong>
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                <button type="button" className="btn btn-outline" onClick={() => { setShowConfirm(false); setPendingAction(null); setCapturedTime(null); }} style={{ padding: "0.5rem 1rem" }}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary" onClick={confirmTraineeAction} disabled={loading} style={{ padding: "0.5rem 1rem" }}>
                  {loading ? "Saving\u2026" : "Confirm"}
                </button>
              </div>
            </div>
          </div>
        )}

        {showAccomplishmentModal && (
          <RightSidebarDrawer
            onClose={() => setShowAccomplishmentModal(false)}
            width={560}
          >
            <div className="drawer-form-card" style={{ minHeight: "100%", display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
                <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 600 }}>
                  {showScriptsPanel ? "Accomplishment Scripts" : "Submit Accomplishment"}
                </h3>
              </div>

              {!showScriptsPanel && (
                <>
                  <p style={{ fontSize: "0.84rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
                    Time Out has been recorded. Add your accomplishment to complete today&apos;s log.
                  </p>

                  <div className="form-group" style={{ flex: 1 }}>
                    <label>Accomplishment</label>
                    <textarea
                      rows={11}
                      value={accomplishmentText}
                      onChange={(e) => setAccomplishmentText(sanitizeInput(e.target.value))}
                      placeholder="What did you accomplish today?"
                    />
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", marginTop: "0.85rem" }}>
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => {
                        setShowScriptsPanel(true);
                        setScriptMode("list");
                      }}
                    >
                      <span aria-hidden="true">📚</span>
                      Scripts
                    </button>

                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={loading || !accomplishmentText.trim()}
                      onClick={handleSaveAccomplishment}
                    >
                      {loading ? "Saving..." : "Confirm Accomplishment"}
                    </button>
                  </div>
                </>
              )}

              {showScriptsPanel && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", gap: "0.5rem" }}>
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => {
                        if (scriptMode === "list") {
                          setShowScriptsPanel(false);
                          return;
                        }
                        setScriptMode("list");
                        setEditingScriptId(null);
                        setScriptTitle("");
                        setScriptContent("");
                        setScriptsError("");
                      }}
                    >
                      ← Back
                    </button>

                    {scriptMode === "list" && (
                      <button type="button" className="btn btn-primary" onClick={handleStartCreateScript}>
                        + New Script
                      </button>
                    )}
                  </div>

                  {scriptsError && (
                    <div style={{ padding: "0.6rem 0.85rem", borderRadius: "var(--radius-sm)", background: "var(--danger-light)", border: "1px solid var(--danger)", color: "var(--danger)", fontSize: "0.85rem", marginBottom: "0.65rem" }}>
                      {scriptsError}
                    </div>
                  )}

                  {scriptMode === "list" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", maxHeight: "calc(100vh - 220px)", overflowY: "auto", paddingRight: "0.2rem" }}>
                      {scriptsLoading && <span style={{ fontSize: "0.84rem", color: "var(--text-muted)" }}>Loading scripts...</span>}

                      {!scriptsLoading && scripts.length === 0 && (
                        <div style={{ border: "1px dashed var(--border)", borderRadius: "var(--radius-sm)", padding: "0.8rem", color: "var(--text-muted)", fontSize: "0.84rem" }}>
                          No scripts saved yet. Create one so you can reuse it later.
                        </div>
                      )}

                      {scripts.map((script) => (
                        <div key={script.id} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "0.75rem" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", marginBottom: "0.35rem" }}>
                            <strong style={{ fontSize: "0.9rem" }}>{script.title}</strong>
                            <div style={{ display: "flex", gap: "0.35rem" }}>
                              <button type="button" className="btn btn-outline" style={{ padding: "0.28rem 0.55rem", fontSize: "0.74rem" }} onClick={() => handleStartEditScript(script)}>
                                Edit
                              </button>
                              <button type="button" className="btn btn-primary" style={{ padding: "0.28rem 0.55rem", fontSize: "0.74rem" }} onClick={() => handleUseScript(script.content)}>
                                Use
                              </button>
                            </div>
                          </div>
                          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.82rem", whiteSpace: "pre-wrap" }}>
                            {script.content.length > 180 ? `${script.content.slice(0, 180)}...` : script.content}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  {(scriptMode === "create" || scriptMode === "edit") && (
                    <>
                      <div className="form-group">
                        <label>Script Title</label>
                        <input
                          type="text"
                          value={scriptTitle}
                          onChange={(e) => setScriptTitle(sanitizeInput(e.target.value))}
                          placeholder="e.g., Daily Support Tasks"
                          maxLength={80}
                        />
                      </div>

                      <div className="form-group" style={{ flex: 1 }}>
                        <label>Script Content</label>
                        <textarea
                          rows={10}
                          value={scriptContent}
                          onChange={(e) => setScriptContent(sanitizeInput(e.target.value))}
                          placeholder="Write the reusable accomplishment text here..."
                          maxLength={2000}
                        />
                      </div>

                      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.75rem" }}>
                        <button type="button" className="btn btn-primary" onClick={handleSaveScript} disabled={scriptsLoading}>
                          {scriptsLoading ? "Saving..." : scriptMode === "edit" ? "Update Script" : "Create Script"}
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </RightSidebarDrawer>
        )}
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════
  // ADMIN FORM RENDER (also used for edit mode)
  // ════════════════════════════════════════════════════════════
  return (
    <div className="card" style={{ marginBottom: "1.5rem", position: "relative", overflow: "hidden" }}>
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
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            )}
          </div>
          <h3 style={{ fontSize: "1.05rem", fontWeight: 600 }}>
            {isEditing ? "Edit Log Entry" : "Add Log Entry"}
          </h3>
        </div>
      </div>

      <form onSubmit={handleAdminSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem" }}>
          <div className="form-group">
            <label>Date</label>
            {lockCoreFields ? (
              <input type="text" value={formatDisplayDateFromDateOnly(date)} readOnly />
            ) : (
              <DatePicker value={date} onChange={setDate} max={today} />
            )}
          </div>

          <div className="form-group">
            <label>Time In *</label>
            <div style={{ display: "flex", gap: "0.35rem" }}>
              <input type="time" value={timeIn} onChange={(e) => setTimeIn(e.target.value)} style={{ flex: 1 }} disabled={lockCoreFields} />
              {!lockCoreFields && (
                <button type="button" className="btn btn-outline" style={{ padding: "0.3rem 0.5rem", fontSize: "0.75rem", whiteSpace: "nowrap" }} onClick={() => { const n = new Date(); setTimeIn(`${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`); }}>
                  Now
                </button>
              )}
            </div>
          </div>

          <div className="form-group">
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              Lunch Start
              {!lockCoreFields && (
                <button
                  type="button"
                  onClick={() => setNoLunch(!noLunch)}
                  className={noLunch ? "badge badge-warning" : "badge badge-info"}
                  style={{ cursor: "pointer", fontSize: "0.68rem", padding: "0.1rem 0.4rem", border: "none" }}
                >
                  {noLunch ? "No Lunch" : "Has Lunch"}
                </button>
              )}
            </label>
            <input type="time" value={lunchStart} onChange={(e) => setLunchStart(e.target.value)} disabled={noLunch || lockCoreFields} style={{ opacity: noLunch || lockCoreFields ? 0.4 : 1 }} />
          </div>

          <div className="form-group">
            <label>Lunch End</label>
            <input type="time" value={lunchEnd} onChange={(e) => setLunchEnd(e.target.value)} disabled={noLunch || lockCoreFields} style={{ opacity: noLunch || lockCoreFields ? 0.4 : 1 }} />
          </div>

          <div className="form-group">
            <label>Time Out</label>
            <div style={{ display: "flex", gap: "0.35rem" }}>
              <input type="time" value={timeOut} onChange={(e) => setTimeOut(e.target.value)} style={{ flex: 1 }} disabled={lockCoreFields} />
              {!lockCoreFields && (
                <button type="button" className="btn btn-outline" style={{ padding: "0.3rem 0.5rem", fontSize: "0.75rem", whiteSpace: "nowrap" }} onClick={() => { const n = new Date(); setTimeOut(`${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`); }}>
                  Now
                </button>
              )}
            </div>
          </div>
        </div>

        {lockCoreFields && (
          <div style={{ margin: "0.65rem 0 0.25rem", fontSize: "0.82rem", color: "var(--text-muted)" }}>
            Date and time fields are locked while editing. You can only update accomplishment and offset values.
          </div>
        )}

        <div style={{
          background: "var(--bg-subtle)",
          borderRadius: "var(--radius-sm)",
          padding: "0.75rem 0.85rem",
          margin: "0.65rem 0 0.85rem",
          border: "1px solid var(--border)",
          display: "grid",
          gap: "0.7rem",
        }}>
          <div style={{
            display: "flex",
            gap: "1.25rem",
            fontSize: "0.82rem",
            color: "var(--text-muted)",
            padding: "0.5rem 0.7rem",
            background: "var(--primary-lighter)",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--primary-light)",
            flexWrap: "wrap",
          }}>
            <span style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
              Hours: <strong style={{ color: "var(--text)" }}>{formatMinutes(previewMetrics.hoursWorked)}</strong>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={previewMetrics.overtime > 0 ? "var(--primary)" : "var(--text-faint)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>
              Overtime: <strong style={{ color: previewMetrics.overtime > 0 ? "var(--primary)" : "var(--text)" }}>{formatMinutes(previewMetrics.overtime)}</strong>
            </span>
          </div>

          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "0.75rem 0.9rem",
            alignItems: "end",
          }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", minWidth: "220px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.45rem", fontSize: "0.9rem", cursor: "pointer", fontWeight: 600, color: "var(--text-secondary)" }}>
                <input
                  type="checkbox"
                  checked={applyOffset}
                  onChange={(e) => {
                    setApplyOffset(e.target.checked);
                    if (!e.target.checked) setOffsetAmount("");
                  }}
                  disabled={effectiveAvailable <= 0 || offsetBlockedByOvertime}
                  style={{ width: "1rem", height: "1rem", accentColor: "var(--primary)" }}
                />
                Apply Offset
              </label>

              <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap" }}>
                <span className="badge badge-info" style={{ fontSize: "0.74rem" }}>
                  Available: {formatMinutes(effectiveAvailable)}
                </span>
                {offsetBlockedByOvertime && (
                  <span className="badge badge-warning" style={{ fontSize: "0.74rem" }}>
                    Disabled when overtime &gt; 0
                  </span>
                )}
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Minutes to apply</label>
              <input
                type="number"
                step="1"
                min="0"
                max={effectiveAvailable}
                value={offsetAmount}
                onChange={(e) => setOffsetAmount(e.target.value)}
                placeholder={`max ${effectiveAvailable}`}
                disabled={!applyOffset || effectiveAvailable <= 0 || offsetBlockedByOvertime}
              />
            </div>
          </div>
        </div>

        <div className="form-group">
          <label>Accomplishment</label>
          <textarea
            rows={3}
            value={accomplishment}
            onChange={(e) => setAccomplishment(sanitizeInput(e.target.value))}
            placeholder="What did you accomplish today? (optional)"
          />
        </div>

        {error && (
          <div style={{
            padding: "0.6rem 0.85rem", borderRadius: "var(--radius-sm)",
            background: "var(--danger-light)", border: "1px solid var(--danger)",
            color: "var(--danger)", fontSize: "0.85rem", marginBottom: "0.65rem",
            display: "flex", alignItems: "center", gap: "0.4rem",
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
            {error}
          </div>
        )}

        <button type="submit" className="btn btn-primary" disabled={loading} style={{ gap: "0.35rem" }}>
          {loading ? (
            "Saving\u2026"
          ) : isEditing ? (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              Update Log
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              Add Log
            </>
          )}
        </button>
      </form>
    </div>
  );
}