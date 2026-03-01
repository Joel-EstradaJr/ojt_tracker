"use client";

// ============================================================
// Trainee Dashboard Page
// Shows trainee info, progress, log entries, add-log form,
// export buttons, and import CSV uploader.
// ============================================================

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Trainee, LogEntry } from "@/types";
import { fetchTrainee, fetchLogs, deleteLog, downloadExport } from "@/lib/api";
import LogForm from "@/components/LogForm";
import ImportCSV from "@/components/ImportCSV";

export default function TraineeDashboard() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [trainee, setTrainee] = useState<Trainee | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [totalHours, setTotalHours] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editingLog, setEditingLog] = useState<LogEntry | null>(null);
  const [deletingLog, setDeletingLog] = useState<LogEntry | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Load trainee + logs
  const loadData = useCallback(async () => {
    try {
      const [t, logsRes] = await Promise.all([fetchTrainee(id), fetchLogs(id)]);
      setTrainee(t);
      setLogs(logsRes.logs);
      setTotalHours(logsRes.totalHours);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleDelete = async () => {
    if (!deletingLog) return;
    setDeleteLoading(true);
    try {
      await deleteLog(deletingLog.id);
      setDeletingLog(null);
      loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setDeleteLoading(false);
    }
  };

  if (loading) {
    return <div className="container"><p>Loading…</p></div>;
  }

  if (!trainee) {
    return <div className="container"><p>Trainee not found.</p></div>;
  }

  const remaining = Math.max(0, trainee.requiredHours - totalHours);
  const percent = Math.min(100, Math.round((totalHours / trainee.requiredHours) * 100));

  return (
    <div className="container">
      {/* Back button */}
      <button className="btn btn-outline" onClick={() => router.push("/")} style={{ marginBottom: "1rem" }}>
        ← Back
      </button>

      {/* Trainee header */}
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h2>{trainee.displayName}</h2>
        <p className="meta" style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
          {trainee.companyName && <>{trainee.companyName} &bull; </>}{trainee.school}
        </p>

        {/* Supervisors */}
        {trainee.supervisors && trainee.supervisors.length > 0 && (
          <div style={{ marginTop: "0.75rem", padding: "0.6rem 0.75rem", background: "var(--bg)", borderRadius: "6px" }}>
            <p style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-muted)", marginBottom: "0.35rem", textTransform: "uppercase", letterSpacing: "0.03em" }}>
              {trainee.supervisors.length === 1 ? "Supervisor" : "Supervisors"}
            </p>
            {trainee.supervisors.map((s) => (
              <div key={s.id} style={{ fontSize: "0.88rem", marginBottom: "0.25rem" }}>
                <strong>{s.displayName}</strong>
                {(s.email || s.contactNumber) && (
                  <span style={{ color: "var(--text-muted)", marginLeft: "0.5rem", fontSize: "0.82rem" }}>
                    {[s.email, s.contactNumber].filter(Boolean).join(" • ")}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Progress */}
        <div style={{ marginTop: "1rem" }}>
          <div className="progress-bar-track">
            <div className="progress-bar-fill" style={{ width: `${percent}%` }} />
          </div>
          <p style={{ marginTop: "0.4rem", fontSize: "0.85rem" }}>
            <strong>{totalHours.toFixed(1)}</strong> / {trainee.requiredHours} hrs rendered
            &nbsp;|&nbsp; <strong>{remaining.toFixed(1)}</strong> hrs remaining
            &nbsp;|&nbsp; {percent}%
          </p>
        </div>
      </div>

      {/* Export / Import Row */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1.5rem" }}>
        <button className="btn btn-outline" onClick={() => downloadExport(id, "csv")}>
          Export CSV
        </button>
        <button className="btn btn-outline" onClick={() => downloadExport(id, "excel")}>
          Export Excel
        </button>
        <button className="btn btn-outline" onClick={() => downloadExport(id, "pdf")}>
          Export PDF
        </button>
        <ImportCSV traineeId={id} onImported={loadData} />
      </div>

      {/* Add / Edit Log Form */}
      <LogForm traineeId={id} onCreated={loadData} editingLog={editingLog} onCancelEdit={() => setEditingLog(null)} />

      {/* Logs Table */}
      {logs.length === 0 ? (
        <p style={{ marginTop: "1rem", color: "var(--text-muted)" }}>No logs recorded yet.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="logs-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Time In</th>
                <th>Lunch Start</th>
                <th>Lunch End</th>
                <th>Time Out</th>
                <th>Hours Worked</th>
                <th>Accomplishment</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {[...logs]
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                .map((log) => {
                  const d = new Date(log.date);
                  const dateStr = d.toLocaleDateString("en-PH", { timeZone: "Asia/Manila" });
                  const dayName = d.toLocaleDateString("en-PH", { timeZone: "Asia/Manila", weekday: "long" });
                  const timeFmt = (iso: string) =>
                    new Date(iso).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit" });

                  const hrs = Math.floor(log.hoursWorked);
                  const mins = Math.round((log.hoursWorked - hrs) * 60);
                  const hoursLabel = mins === 0
                    ? `${hrs} hr${hrs !== 1 ? "s" : ""}`
                    : `${hrs} hr${hrs !== 1 ? "s" : ""} ${mins} min${mins !== 1 ? "s" : ""}`;

                  return (
                    <tr key={log.id}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {dateStr}<br />
                        <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>({dayName})</span>
                      </td>
                      <td>{timeFmt(log.timeIn)}</td>
                      <td>{timeFmt(log.lunchStart)}</td>
                      <td>{timeFmt(log.lunchEnd)}</td>
                      <td>{timeFmt(log.timeOut)}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{hoursLabel}</td>
                      <td className="accomplishment-cell">
                        <div className="accomplishment-content">{log.accomplishment}</div>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <button className="btn btn-outline" style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem", marginRight: "0.35rem" }} onClick={() => setEditingLog(log)}>
                          Edit
                        </button>
                        <button className="btn btn-danger" style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem" }} onClick={() => setDeletingLog(log)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingLog && (() => {
        const dl = deletingLog;
        const d = new Date(dl.date);
        const dateStr = d.toLocaleDateString("en-PH", { timeZone: "Asia/Manila" });
        const dayName = d.toLocaleDateString("en-PH", { timeZone: "Asia/Manila", weekday: "long" });
        const timeFmt = (iso: string) =>
          new Date(iso).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit" });
        const hrs = Math.floor(dl.hoursWorked);
        const mins = Math.round((dl.hoursWorked - hrs) * 60);
        const hoursLabel = mins === 0
          ? `${hrs} hr${hrs !== 1 ? "s" : ""}`
          : `${hrs} hr${hrs !== 1 ? "s" : ""} ${mins} min${mins !== 1 ? "s" : ""}`;

        return (
          <div className="modal-overlay" onClick={() => !deleteLoading && setDeletingLog(null)}>
            <div className="modal-content" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
              <h2 style={{ marginBottom: "0.25rem", color: "var(--danger)" }}>Delete Log Entry</h2>
              <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
                Are you sure you want to permanently delete this log entry for <strong>{trainee.displayName}</strong>?
              </p>

              <div style={{ background: "var(--bg)", borderRadius: "6px", padding: "0.75rem 1rem", marginBottom: "1rem", fontSize: "0.88rem" }}>
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.3rem 0.75rem" }}>
                  <strong>Date:</strong>
                  <span>{dateStr} ({dayName})</span>
                  <strong>Time In:</strong>
                  <span>{timeFmt(dl.timeIn)}</span>
                  <strong>Lunch Start:</strong>
                  <span>{timeFmt(dl.lunchStart)}</span>
                  <strong>Lunch End:</strong>
                  <span>{timeFmt(dl.lunchEnd)}</span>
                  <strong>Time Out:</strong>
                  <span>{timeFmt(dl.timeOut)}</span>
                  <strong>Hours Worked:</strong>
                  <span>{hoursLabel}</span>
                  <strong>Accomplishment:</strong>
                  <span style={{ whiteSpace: "pre-wrap", maxHeight: "6rem", overflowY: "auto" }}>{dl.accomplishment}</span>
                </div>
              </div>

              <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                <button className="btn btn-outline" onClick={() => setDeletingLog(null)} disabled={deleteLoading}>
                  Cancel
                </button>
                <button className="btn btn-danger" onClick={handleDelete} disabled={deleteLoading}>
                  {deleteLoading ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
