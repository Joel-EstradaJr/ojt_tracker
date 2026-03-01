"use client";

// ============================================================
// TraineeCard — displays a single trainee's summary card
// including name, school, company, progress bar, hours,
// and edit/delete action buttons.
// ============================================================

import { Trainee } from "@/types";

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

  return (
    <div className="card trainee-card" onClick={onClick}>
      <h3>{trainee.displayName}</h3>
      <p className="meta">{trainee.school}</p>
      <p className="meta" style={{ marginTop: "-0.15rem" }}>{trainee.companyName}</p>

      {/* Progress bar */}
      <div className="progress-bar-track">
        <div className="progress-bar-fill" style={{ width: `${percent}%` }} />
      </div>

      <p style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
        <strong>{trainee.totalHoursRendered.toFixed(1)}</strong> / {trainee.requiredHours} hrs
        ({percent}%)
      </p>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.75rem" }}>
        <button
          className="btn btn-outline"
          style={{ flex: 1, fontSize: "0.8rem", padding: "0.35rem 0" }}
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
        >
          Edit
        </button>
        <button
          className="btn btn-danger"
          style={{ flex: 1, fontSize: "0.8rem", padding: "0.35rem 0" }}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
