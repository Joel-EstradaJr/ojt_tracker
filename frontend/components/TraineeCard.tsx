"use client";

// ============================================================
// TraineeCard - displays a single trainee's summary card
// including name, school, company, progress bar, hours,
// expected end date, and edit/delete action buttons.
// ============================================================

import { Trainee } from "@/types";
import { calculateExpectedEndDate } from "@/lib/ph-holidays";

interface Props {
  trainee: Trainee;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export default function TraineeCard({ trainee, onClick, onEdit, onDelete }: Props) {
  const percent = Math.min(
    100,
    Math.round((trainee.totalHoursRendered / trainee.requiredHours) * 100)
  );

  const isComplete = percent >= 100;

  // Calculate expected end date from remaining hours
  const remainingHours = Math.max(0, trainee.requiredHours - trainee.totalHoursRendered);
  const remainingDays = Math.ceil(remainingHours / 8);
  const endDate = isComplete ? null : calculateExpectedEndDate(remainingDays);
  const formattedEndDate = endDate
    ? endDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  return (
    <div className="card trainee-card" onClick={onClick}>
      {/* Top section with name and badge */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{trainee.displayName}</h3>
        </div>
        {isComplete ? (
          <span className="badge badge-success" style={{ flexShrink: 0, marginLeft: "0.5rem" }}>Complete</span>
        ) : (
          <span className="badge badge-primary" style={{ flexShrink: 0, marginLeft: "0.5rem" }}>{percent}%</span>
        )}
      </div>

      {/* Meta info */}
      <div style={{ marginBottom: "1rem" }}>
        <p className="meta" style={{ marginBottom: "0.15rem" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5, flexShrink: 0 }}><path d="M22 10v6M2 10l10-5 10 5-10 5z" /><path d="M6 12v5c3 3 9 3 12 0v-5" /></svg>
          {trainee.school}
        </p>
        <p className="meta">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5, flexShrink: 0 }}><rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>
          {trainee.companyName}
        </p>
      </div>

      {/* Progress bar */}
      <div className="progress-bar-track">
        <div
          className="progress-bar-fill"
          style={{
            width: `${percent}%`,
            background: isComplete
              ? "linear-gradient(90deg, var(--success) 0%, #34d399 100%)"
              : undefined,
          }}
        />
      </div>

      {/* Hours + Expected End Date — same row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.5rem", fontSize: "0.84rem", color: "var(--text-muted)" }}>
        <span>
          <strong style={{ color: "var(--text)" }}>{trainee.totalHoursRendered.toFixed(1)}</strong> / {trainee.requiredHours} hrs
        </span>
        {formattedEndDate && (
          <span style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
            {formattedEndDate}
          </span>
        )}
        {isComplete && (
          <span style={{ color: "var(--success)", fontWeight: 500 }}>✓ Done</span>
        )}
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.85rem", borderTop: "1px solid var(--border)", paddingTop: "0.85rem" }}>
        <button
          className="btn btn-outline"
          style={{ flex: 1, fontSize: "0.82rem", padding: "0.4rem 0" }}
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
          Edit
        </button>
        <button
          className="btn btn-danger"
          style={{ flex: 1, fontSize: "0.82rem", padding: "0.4rem 0" }}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
          Delete
        </button>
      </div>
    </div>
  );
}

