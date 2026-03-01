"use client";

// ============================================================
// Trainee Dashboard Page
// Shows trainee info, progress, log entries, add-log form,
// export buttons, and import CSV uploader.
// ============================================================

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Trainee, LogEntry } from "@/types";
import { fetchTrainee, fetchLogs, deleteLog, downloadExport } from "@/lib/api";
import LogForm from "@/components/LogForm";
import ImportCSV from "@/components/ImportCSV";
import { calculateExpectedEndDate } from "@/lib/ph-holidays";
import { ThemeToggle } from "@/components/ThemeProvider";

export default function TraineeDashboard() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [trainee, setTrainee] = useState<Trainee | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [totalHours, setTotalHours] = useState(0);
  const [totalOvertime, setTotalOvertime] = useState(0);
  const [totalOffsetUsed, setTotalOffsetUsed] = useState(0);
  const [availableOffset, setAvailableOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editingLog, setEditingLog] = useState<LogEntry | null>(null);
  const [deletingLog, setDeletingLog] = useState<LogEntry | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Pagination
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  // Filter & Sort
  const [sortField, setSortField] = useState<"date" | "timeIn" | "lunchStart" | "lunchEnd" | "timeOut" | "hoursWorked" | "overtime" | "offsetUsed">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [showFilters, setShowFilters] = useState(false);
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterMinHours, setFilterMinHours] = useState("");
  const [filterMaxHours, setFilterMaxHours] = useState("");
  const [filterOvertime, setFilterOvertime] = useState<"all" | "yes" | "no">("all");
  const [filterOffset, setFilterOffset] = useState<"all" | "yes" | "no">("all");
  const [filterAccomplishment, setFilterAccomplishment] = useState("");

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
    setCurrentPage(1);
  };

  const hasActiveFilters = !!(filterDateFrom || filterDateTo || filterMinHours || filterMaxHours || filterOvertime !== "all" || filterOffset !== "all" || filterAccomplishment);
  const activeFilterCount = [filterDateFrom, filterDateTo, filterMinHours, filterMaxHours, filterOvertime !== "all" ? "1" : "", filterOffset !== "all" ? "1" : "", filterAccomplishment].filter(Boolean).length;
  const clearFilters = () => { setFilterDateFrom(""); setFilterDateTo(""); setFilterMinHours(""); setFilterMaxHours(""); setFilterOvertime("all"); setFilterOffset("all"); setFilterAccomplishment(""); setCurrentPage(1); };

  // Load trainee + logs
  const loadData = useCallback(async () => {
    try {
      const [t, logsRes] = await Promise.all([fetchTrainee(id), fetchLogs(id)]);
      setTrainee(t);
      setLogs(logsRes.logs);
      setTotalHours(logsRes.totalHours);
      setTotalOvertime(logsRes.totalOvertime);
      setTotalOffsetUsed(logsRes.totalOffsetUsed);
      setAvailableOffset(logsRes.availableOffset);
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
    return (
      <div className="container">
        <div className="skeleton">
          <div className="skeleton-card" style={{ height: "200px" }}>
            <div className="skeleton-line medium" />
            <div className="skeleton-line short" />
            <div className="skeleton-line" />
            <div className="skeleton-line thin" />
          </div>
          <div className="skeleton-card" style={{ height: "180px" }}>
            <div className="skeleton-line medium" />
            <div className="skeleton-line" />
            <div className="skeleton-line short" />
          </div>
        </div>
      </div>
    );
  }

  if (!trainee) {
    return (
      <div className="container">
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <h3>Trainee Not Found</h3>
          <p>The trainee you are looking for does not exist or has been removed.</p>
          <button className="btn btn-primary" style={{ marginTop: "1rem" }} onClick={() => router.push("/")}>
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const remaining = Math.max(0, trainee.requiredHours - totalHours);
  const remainingDays = Math.ceil(remaining / 8);
  const percent = Math.min(100, Math.round((totalHours / trainee.requiredHours) * 100));
  const expectedEndDate = remaining > 0
    ? calculateExpectedEndDate(remainingDays)
    : null;

  return (
    <div className="container">
      {/* Top bar */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}
      >
        <button className="btn btn-outline" onClick={() => router.push("/")} style={{ gap: "0.35rem" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
          Back
        </button>
        <ThemeToggle />
      </motion.div>

      {/* Trainee header card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="card"
        style={{ marginBottom: "1.5rem", position: "relative", overflow: "hidden" }}
      >
        {/* Subtle gradient accent bar */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "3px", background: "var(--gradient-hero)" }} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.75rem", marginBottom: "0.5rem" }}>
          <div>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.01em" }}>{trainee.displayName}</h2>
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginTop: "0.2rem", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              {trainee.companyName && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}><rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>
                  {trainee.companyName}
                </span>
              )}
              {trainee.companyName && <span style={{ opacity: 0.3 }}>|</span>}
              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}><path d="M22 10v6M2 10l10-5 10 5-10 5z" /><path d="M6 12v5c3 3 9 3 12 0v-5" /></svg>
                {trainee.school}
              </span>
            </p>
          </div>
          {percent >= 100 ? (
            <span className="badge badge-success" style={{ fontSize: "0.78rem", padding: "0.3rem 0.75rem" }}>OJT Complete</span>
          ) : (
            <span className="badge badge-primary" style={{ fontSize: "0.78rem", padding: "0.3rem 0.75rem" }}>{percent}% Complete</span>
          )}
        </div>

        {/* Supervisors */}
        {trainee.supervisors && trainee.supervisors.length > 0 && (
          <div className="supervisor-block">
            <p className="sup-label">
              {trainee.supervisors.length === 1 ? "Supervisor" : "Supervisors"}
            </p>
            {trainee.supervisors.map((s) => (
              <div key={s.id} className="sup-entry">
                <strong>{s.displayName}</strong>
                {(s.email || s.contactNumber) && (
                  <span className="sup-meta">
                    {[s.email, s.contactNumber].filter(Boolean).join(" | ")}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Progress */}
        <div style={{ marginTop: "1.25rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
            <span style={{ fontSize: "0.84rem", fontWeight: 600, color: "var(--text-secondary)" }}>Progress</span>
            <span style={{ fontSize: "0.84rem", fontWeight: 700, color: "var(--primary)" }}>{percent}%</span>
          </div>
          <div className="progress-bar-track">
            <div className="progress-bar-fill" style={{
              width: `${percent}%`,
              background: percent >= 100 ? "linear-gradient(90deg, var(--success) 0%, #34d399 100%)" : undefined,
            }} />
          </div>
        </div>

        {/* Stats row */}
        <div className="stat-row">
          <div className="stat-item">
            <div className="label">Hours Rendered</div>
            <div className="value">{totalHours.toFixed(1)}</div>
          </div>
          <div className="stat-item">
            <div className="label">Remaining Hours</div>
            <div className="value">{remaining.toFixed(1)}</div>
          </div>
          <div className="stat-item">
            <div className="label">Overtime Hours</div>
            <div className="value">{totalOvertime.toFixed(2)}</div>
          </div>
          <div className="stat-item">
            <div className="label">Offset Hours Used</div>
            <div className="value">{totalOffsetUsed.toFixed(2)}</div>
          </div>
          <div className="stat-item">
            <div className="label">Available Offset Hours</div>
            <div className="value">{availableOffset.toFixed(2)}</div>
          </div>
        </div>

        {expectedEndDate && (
          <p style={{ marginTop: "0.75rem", fontSize: "0.84rem", color: "var(--primary)", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.35rem" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            Expected End: {expectedEndDate.toLocaleDateString("en-PH", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          </p>
        )}
        {remaining <= 0 && (
          <p style={{ marginTop: "0.75rem", fontSize: "0.88rem", color: "var(--success-text)", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.35rem" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            OJT hours completed!
          </p>
        )}
      </motion.div>

      {/* Export / Import Row */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "1.5rem" }}
      >
        <button className="btn btn-outline" onClick={() => downloadExport(id, "csv")} style={{ gap: "0.35rem" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          CSV
        </button>
        <button className="btn btn-outline" onClick={() => downloadExport(id, "excel")} style={{ gap: "0.35rem" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Excel
        </button>
        <button className="btn btn-outline" onClick={() => downloadExport(id, "pdf")} style={{ gap: "0.35rem" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          PDF
        </button>
        <ImportCSV traineeId={id} onImported={loadData} />
      </motion.div>

      {/* Add / Edit Log Form */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.15 }}
      >
        <LogForm traineeId={id} onCreated={loadData} editingLog={editingLog} onCancelEdit={() => setEditingLog(null)} availableOffset={availableOffset} />
      </motion.div>

      {/* Logs Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.2 }}
      >
      {logs.length === 0 ? (
        <div className="empty-state" style={{ padding: "3rem 2rem" }}>
          <div className="empty-state-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          </div>
          <h3>No Logs Yet</h3>
          <p>Start tracking your OJT hours by adding your first log entry above.</p>
        </div>
      ) : (() => {
        // Apply filters
        let filtered = [...logs];
        if (filterDateFrom) filtered = filtered.filter(l => l.date >= filterDateFrom);
        if (filterDateTo) filtered = filtered.filter(l => l.date <= filterDateTo);
        if (filterMinHours) filtered = filtered.filter(l => l.hoursWorked >= Number(filterMinHours));
        if (filterMaxHours) filtered = filtered.filter(l => l.hoursWorked <= Number(filterMaxHours));
        if (filterOvertime === "yes") filtered = filtered.filter(l => l.overtime > 0);
        else if (filterOvertime === "no") filtered = filtered.filter(l => l.overtime === 0);
        if (filterOffset === "yes") filtered = filtered.filter(l => l.offsetUsed > 0);
        else if (filterOffset === "no") filtered = filtered.filter(l => l.offsetUsed === 0);
        if (filterAccomplishment) { const q = filterAccomplishment.toLowerCase(); filtered = filtered.filter(l => l.accomplishment.toLowerCase().includes(q)); }

        // Apply sort
        const sortedLogs = [...filtered].sort((a, b) => {
          let cmp = 0;
          switch (sortField) {
            case "date": cmp = new Date(a.date).getTime() - new Date(b.date).getTime(); break;
            case "timeIn": cmp = new Date(a.timeIn).getTime() - new Date(b.timeIn).getTime(); break;
            case "lunchStart": cmp = new Date(a.lunchStart).getTime() - new Date(b.lunchStart).getTime(); break;
            case "lunchEnd": cmp = new Date(a.lunchEnd).getTime() - new Date(b.lunchEnd).getTime(); break;
            case "timeOut": cmp = new Date(a.timeOut).getTime() - new Date(b.timeOut).getTime(); break;
            case "hoursWorked": cmp = a.hoursWorked - b.hoursWorked; break;
            case "overtime": cmp = a.overtime - b.overtime; break;
            case "offsetUsed": cmp = a.offsetUsed - b.offsetUsed; break;
          }
          return sortDir === "asc" ? cmp : -cmp;
        });

        const totalPages = Math.max(1, Math.ceil(sortedLogs.length / pageSize));
        const safePage = Math.min(currentPage, totalPages);
        const startIdx = (safePage - 1) * pageSize;
        const paginatedLogs = sortedLogs.slice(startIdx, startIdx + pageSize);
        const showFrom = sortedLogs.length > 0 ? startIdx + 1 : 0;
        const showTo = Math.min(startIdx + pageSize, sortedLogs.length);

        const sortTh = (field: typeof sortField, label: string) => (
          <th key={field} onClick={() => handleSort(field)} style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
              {label}
              {sortField === field ? (
                <span style={{ fontSize: "0.7rem", lineHeight: 1 }}>{sortDir === "asc" ? "\u25B2" : "\u25BC"}</span>
              ) : (
                <span style={{ fontSize: "0.7rem", opacity: 0.3, lineHeight: 1 }}>{"\u21C5"}</span>
              )}
            </span>
          </th>
        );

        return (
        <>
        {/* Page size selector */}
        <div className="pagination-bar">
          <div className="pagination-info">
            Showing <strong>{showFrom}</strong>&ndash;<strong>{showTo}</strong> of <strong>{sortedLogs.length}</strong>{hasActiveFilters && <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>{" "}(filtered from {logs.length})</span>} entries
          </div>
          <div className="pagination-size">
            <label htmlFor="pageSize">Rows per page:</label>
            <select
              id="pageSize"
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
            >
              {[5, 10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Filter Controls */}
        <div style={{ marginTop: "0.75rem" }}>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className={`btn ${showFilters ? "btn-primary" : "btn-outline"}`} onClick={() => setShowFilters(f => !f)} style={{ gap: "0.35rem", fontSize: "0.82rem" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
              Filters
              {activeFilterCount > 0 && <span className="badge badge-primary" style={{ marginLeft: "0.2rem", padding: "0.1rem 0.4rem", fontSize: "0.7rem", minWidth: "1.1rem", textAlign: "center" }}>{activeFilterCount}</span>}
            </button>
            {hasActiveFilters && (
              <button type="button" className="btn btn-ghost" onClick={clearFilters} style={{ fontSize: "0.8rem", gap: "0.25rem", color: "var(--danger)" }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                Clear all
              </button>
            )}
            {hasActiveFilters && (
              <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                {sortedLogs.length} of {logs.length} entries match
              </span>
            )}
          </div>
          {showFilters && (
            <div style={{ marginTop: "0.5rem", padding: "0.75rem", background: "var(--bg-subtle)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "0.5rem" }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: "0.78rem" }}>Date From</label>
                  <input type="date" value={filterDateFrom} onChange={(e) => { setFilterDateFrom(e.target.value); setCurrentPage(1); }} style={{ fontSize: "0.82rem" }} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: "0.78rem" }}>Date To</label>
                  <input type="date" value={filterDateTo} onChange={(e) => { setFilterDateTo(e.target.value); setCurrentPage(1); }} style={{ fontSize: "0.82rem" }} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: "0.78rem" }}>Min Hours</label>
                  <input type="number" min="0" step="0.5" value={filterMinHours} onChange={(e) => { setFilterMinHours(e.target.value); setCurrentPage(1); }} placeholder="0" style={{ fontSize: "0.82rem" }} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: "0.78rem" }}>Max Hours</label>
                  <input type="number" min="0" step="0.5" value={filterMaxHours} onChange={(e) => { setFilterMaxHours(e.target.value); setCurrentPage(1); }} placeholder={"\u221E"} style={{ fontSize: "0.82rem" }} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: "0.78rem" }}>Overtime</label>
                  <select value={filterOvertime} onChange={(e) => { setFilterOvertime(e.target.value as "all" | "yes" | "no"); setCurrentPage(1); }} style={{ fontSize: "0.82rem" }}>
                    <option value="all">All</option>
                    <option value="yes">With Overtime</option>
                    <option value="no">No Overtime</option>
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label style={{ fontSize: "0.78rem" }}>Offset Used</label>
                  <select value={filterOffset} onChange={(e) => { setFilterOffset(e.target.value as "all" | "yes" | "no"); setCurrentPage(1); }} style={{ fontSize: "0.82rem" }}>
                    <option value="all">All</option>
                    <option value="yes">With Offset</option>
                    <option value="no">No Offset</option>
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0, gridColumn: "1 / -1" }}>
                  <label style={{ fontSize: "0.78rem" }}>Accomplishment</label>
                  <input type="text" value={filterAccomplishment} onChange={(e) => { setFilterAccomplishment(e.target.value); setCurrentPage(1); }} placeholder={"Search accomplishments\u2026"} style={{ fontSize: "0.82rem" }} />
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={{ overflowX: "auto", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", marginTop: "0.75rem" }}>
          <table className="logs-table">
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
                <th>Accomplishment</th>
                <th style={{ textAlign: "center" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedLogs.map((log) => {
                  const d = new Date(log.date);
                  const dateStr = d.toLocaleDateString("en-PH", { timeZone: "Asia/Manila" });
                  const dayName = d.toLocaleDateString("en-PH", { timeZone: "Asia/Manila", weekday: "long" });
                  const timeFmt = (iso: string) =>
                    new Date(iso).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit" });

                  const formatH = (v: number) => {
                    const h = Math.floor(v);
                    const m = Math.round((v - h) * 60);
                    return m === 0
                      ? `${h} hr${h !== 1 ? "s" : ""}`
                      : `${h} hr${h !== 1 ? "s" : ""} ${m} min${m !== 1 ? "s" : ""}`;
                  };
                  const hoursLabel = formatH(log.hoursWorked);

                  return (
                    <tr key={log.id}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <span style={{ fontWeight: 500 }}>{dateStr}</span><br />
                        <span style={{ fontSize: "0.76rem", color: "var(--text-faint)" }}>({dayName})</span>
                      </td>
                      <td>{timeFmt(log.timeIn)}</td>
                      <td>{timeFmt(log.lunchStart)}</td>
                      <td>{timeFmt(log.lunchEnd)}</td>
                      <td>{timeFmt(log.timeOut)}</td>
                      <td style={{ whiteSpace: "nowrap", fontWeight: 500 }}>{hoursLabel}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{log.overtime > 0 ? <span style={{ color: "var(--primary)", fontWeight: 500 }}>{formatH(log.overtime)}</span> : <span style={{ color: "var(--text-faint)" }}>-</span>}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{log.offsetUsed > 0 ? <span style={{ color: "var(--accent)", fontWeight: 500 }}>{formatH(log.offsetUsed)}</span> : <span style={{ color: "var(--text-faint)" }}>-</span>}</td>
                      <td className="accomplishment-cell">
                        <div className="accomplishment-content">{log.accomplishment}</div>
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", alignItems: "center" }}>
                          <button className="btn btn-outline" style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem", width: "100%" }} onClick={() => setEditingLog(log)}>
                            Edit
                          </button>
                          <button className="btn btn-danger" style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem", width: "100%" }} onClick={() => setDeletingLog(log)}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {paginatedLogs.length === 0 && (
                  <tr>
                    <td colSpan={10} style={{ textAlign: "center", padding: "2rem 1rem", color: "var(--text-muted)", fontSize: "0.88rem" }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem" }}>
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.3 }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                        No entries match the current filters.
                      </div>
                    </td>
                  </tr>
                )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        {totalPages > 1 && (
          <div className="pagination-controls">
            <button
              className="btn btn-outline pagination-btn"
              disabled={safePage <= 1}
              onClick={() => setCurrentPage(1)}
              title="First page"
            >
              &lt;&lt;
            </button>
            <button
              className="btn btn-outline pagination-btn"
              disabled={safePage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              title="Previous page"
            >
              &lt;
            </button>

            {(() => {
              const pages: (number | string)[] = [];
              const maxVisible = 5;
              let start = Math.max(1, safePage - Math.floor(maxVisible / 2));
              let end = start + maxVisible - 1;
              if (end > totalPages) {
                end = totalPages;
                start = Math.max(1, end - maxVisible + 1);
              }
              if (start > 1) { pages.push(1); if (start > 2) pages.push("..."); }
              for (let i = start; i <= end; i++) pages.push(i);
              if (end < totalPages) { if (end < totalPages - 1) pages.push("..."); pages.push(totalPages); }
              return pages.map((p, idx) =>
                typeof p === "string" ? (
                  <span key={`ellipsis-${idx}`} className="pagination-ellipsis">...</span>
                ) : (
                  <button
                    key={p}
                    className={`btn pagination-btn ${p === safePage ? "pagination-btn-active" : "btn-outline"}`}
                    onClick={() => setCurrentPage(p)}
                  >
                    {p}
                  </button>
                )
              );
            })()}

            <button
              className="btn btn-outline pagination-btn"
              disabled={safePage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              title="Next page"
            >
              &gt;
            </button>
            <button
              className="btn btn-outline pagination-btn"
              disabled={safePage >= totalPages}
              onClick={() => setCurrentPage(totalPages)}
              title="Last page"
            >
              &gt;&gt;
            </button>
          </div>
        )}
        </>
        );
      })()}
      </motion.div>

      {/* Delete Confirmation Modal */}
      {deletingLog && (() => {
        const dl = deletingLog;
        const d = new Date(dl.date);
        const dateStr = d.toLocaleDateString("en-PH", { timeZone: "Asia/Manila" });
        const dayName = d.toLocaleDateString("en-PH", { timeZone: "Asia/Manila", weekday: "long" });
        const timeFmt = (iso: string) =>
          new Date(iso).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit" });
        const fmtH = (v: number) => {
          const h = Math.floor(v);
          const m = Math.round((v - h) * 60);
          return m === 0
            ? `${h} hr${h !== 1 ? "s" : ""}`
            : `${h} hr${h !== 1 ? "s" : ""} ${m} min${m !== 1 ? "s" : ""}`;
        };
        const hoursLabel = fmtH(dl.hoursWorked);

        return (
          <div className="modal-overlay" onClick={() => !deleteLoading && setDeletingLog(null)}>
            <div className="modal-content" style={{ maxWidth: 500 }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
                <div style={{ width: "2.5rem", height: "2.5rem", borderRadius: "var(--radius-sm)", background: "var(--danger-light)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </div>
                <div>
                  <h2 style={{ fontSize: "1.15rem", color: "var(--danger)", marginBottom: "0.1rem" }}>Delete Log Entry</h2>
                  <p style={{ fontSize: "0.84rem", color: "var(--text-muted)" }}>
                    This action cannot be undone.
                  </p>
                </div>
              </div>

              <div style={{ background: "var(--bg-subtle)", borderRadius: "var(--radius-sm)", padding: "0.85rem 1rem", marginBottom: "1.25rem", fontSize: "0.88rem" }}>
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.35rem 0.75rem" }}>
                  <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>Date:</span>
                  <span>{dateStr} ({dayName})</span>
                  <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>Time In:</span>
                  <span>{timeFmt(dl.timeIn)}</span>
                  <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>Lunch Start:</span>
                  <span>{timeFmt(dl.lunchStart)}</span>
                  <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>Lunch End:</span>
                  <span>{timeFmt(dl.lunchEnd)}</span>
                  <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>Time Out:</span>
                  <span>{timeFmt(dl.timeOut)}</span>
                  <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>Hours Worked:</span>
                  <span style={{ fontWeight: 500 }}>{hoursLabel}</span>
                  {dl.overtime > 0 && (<><span style={{ color: "var(--text-muted)", fontWeight: 500 }}>Overtime:</span><span>{fmtH(dl.overtime)}</span></>)}
                  {dl.offsetUsed > 0 && (<><span style={{ color: "var(--text-muted)", fontWeight: 500 }}>Offset Used:</span><span>{fmtH(dl.offsetUsed)}</span></>)}
                  <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>Accomplishment:</span>
                  <span style={{ whiteSpace: "pre-wrap", maxHeight: "6rem", overflowY: "auto" }}>{dl.accomplishment}</span>
                </div>
              </div>

              <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                <button className="btn btn-outline" onClick={() => setDeletingLog(null)} disabled={deleteLoading}>
                  Cancel
                </button>
                <button className="btn btn-danger" onClick={handleDelete} disabled={deleteLoading}>
                  {deleteLoading ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}