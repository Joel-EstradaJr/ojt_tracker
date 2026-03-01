"use client";

// ============================================================
// Dashboard Page (Landing)
// Shows all trainee cards. Click a card → password prompt → logs.
// ============================================================

import { useEffect, useState } from "react";
import { Trainee } from "@/types";
import { fetchTrainees, deleteTrainee } from "@/lib/api";
import TraineeCard from "@/components/TraineeCard";
import PasswordModal from "@/components/PasswordModal";
import CreateTraineeForm from "@/components/CreateTraineeForm";
import EditTraineeForm from "@/components/EditTraineeForm";

export default function HomePage() {
  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingTrainee, setEditingTrainee] = useState<Trainee | null>(null);

  // Fetch all trainees on mount
  const loadTrainees = async () => {
    try {
      const data = await fetchTrainees();
      setTrainees(data);
    } catch (err) {
      console.error("Failed to fetch trainees:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTrainees();
  }, []);

  const handleDelete = async (trainee: Trainee) => {
    if (!confirm(`Delete trainee "${trainee.displayName}"? This will also delete all their logs and supervisors.`)) return;
    try {
      await deleteTrainee(trainee.id);
      loadTrainees();
    } catch (err) {
      console.error("Failed to delete trainee:", err);
    }
  };

  return (
    <div className="container">
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>OJT Progress Tracker</h1>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          + Add Trainee
        </button>
      </div>

      {/* Loading state */}
      {loading && <p style={{ marginTop: "2rem", color: "var(--text-muted)" }}>Loading trainees…</p>}

      {/* Trainee cards grid */}
      {!loading && trainees.length === 0 && (
        <p style={{ marginTop: "2rem", color: "var(--text-muted)" }}>
          No trainees yet. Click <strong>+ Add Trainee</strong> to get started.
        </p>
      )}

      <div className="trainee-grid">
        {trainees.map((t) => (
          <TraineeCard
            key={t.id}
            trainee={t}
            onClick={() => setSelectedId(t.id)}
            onEdit={() => setEditingTrainee(t)}
            onDelete={() => handleDelete(t)}
          />
        ))}
      </div>

      {/* Password modal — shown when a card is clicked */}
      {selectedId && (
        <PasswordModal
          traineeId={selectedId}
          onClose={() => setSelectedId(null)}
        />
      )}

      {/* Create trainee modal */}
      {showCreate && (
        <CreateTraineeForm
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            loadTrainees();
          }}
        />
      )}

      {/* Edit trainee modal */}
      {editingTrainee && (
        <EditTraineeForm
          trainee={editingTrainee}
          onClose={() => setEditingTrainee(null)}
          onUpdated={() => {
            setEditingTrainee(null);
            loadTrainees();
          }}
        />
      )}
    </div>
  );
}
