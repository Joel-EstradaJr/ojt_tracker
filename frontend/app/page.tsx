"use client";

// ============================================================
// Dashboard Page (Landing)
// Shows all trainee cards. Click a card → password prompt → logs.
// ============================================================

import { useEffect, useState, useRef } from "react";
import { Trainee } from "@/types";
import { fetchTrainees, deleteTrainee, verifyPassword, verifySuperPassword, downloadAllCSV, importAllCSV } from "@/lib/api";
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
  const [pendingEditTrainee, setPendingEditTrainee] = useState<Trainee | null>(null);
  const [editPassword, setEditPassword] = useState("");
  const [editPasswordError, setEditPasswordError] = useState("");
  const [editPasswordLoading, setEditPasswordLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  // Super-password gate for Export / Import
  const [pendingAction, setPendingAction] = useState<"export" | "import" | null>(null);
  const [actionPassword, setActionPassword] = useState("");
  const [actionPasswordError, setActionPasswordError] = useState("");
  const [actionPasswordLoading, setActionPasswordLoading] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

  // Import result modal
  const [importResult, setImportResult] = useState<{ trainees: number; supervisors: number; logs: number; skipped: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Delete confirmation modal
  const [deletingTrainee, setDeletingTrainee] = useState<Trainee | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null);

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

  const handleDelete = async () => {
    if (!deletingTrainee) return;
    if (!deletePassword.trim()) {
      setDeleteError("Please enter the trainee's password.");
      return;
    }
    setDeleteLoading(true);
    setDeleteError("");
    try {
      // Verify password first
      await verifyPassword(deletingTrainee.id, deletePassword);
      // Password correct — proceed with deletion
      const name = deletingTrainee.displayName;
      await deleteTrainee(deletingTrainee.id);
      setDeletingTrainee(null);
      setDeletePassword("");
      setDeleteError("");
      setDeleteSuccess(name);
      loadTrainees();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Incorrect password.");
    } finally {
      setDeleteLoading(false);
    }
  };

  const closeDeletingModal = () => {
    if (!deleteLoading) {
      setDeletingTrainee(null);
      setDeletePassword("");
      setDeleteError("");
    }
  };

  const handleImportAll = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportLoading(true);
    setImportError(null);
    try {
      const result = await importAllCSV(file);
      setImportResult(result);
      loadTrainees();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImportLoading(false);
      if (importRef.current) importRef.current.value = "";
    }
  };

  const closeActionModal = () => {
    if (!actionPasswordLoading) {
      setPendingAction(null);
      setActionPassword("");
      setActionPasswordError("");
    }
  };

  const handleActionVerify = async () => {
    if (!pendingAction || !actionPassword.trim()) return;
    setActionPasswordLoading(true);
    setActionPasswordError("");
    try {
      await verifySuperPassword(actionPassword);
      const action = pendingAction;
      setPendingAction(null);
      setActionPassword("");
      setActionPasswordError("");
      if (action === "export") {
        downloadAllCSV();
        setExportSuccess(true);
      } else {
        importRef.current?.click();
      }
    } catch (err) {
      setActionPasswordError(err instanceof Error ? err.message : "Incorrect password.");
    } finally {
      setActionPasswordLoading(false);
    }
  };

  return (
    <div className="container">
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <h1>OJT Progress Tracker</h1>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn btn-outline" onClick={() => setPendingAction("export")}>
            Export All CSV
          </button>
          <button
            className="btn btn-outline"
            onClick={() => setPendingAction("import")}
            disabled={importLoading}
          >
            {importLoading ? "Importing…" : "Import CSV"}
          </button>
          <input
            type="file"
            accept=".csv"
            ref={importRef}
            style={{ display: "none" }}
            onChange={handleImportAll}
          />
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            + Add Trainee
          </button>
        </div>
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
            onEdit={() => setPendingEditTrainee(t)}
            onDelete={() => setDeletingTrainee(t)}
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

      {/* Edit password gate modal */}
      {pendingEditTrainee && !editingTrainee && (
        <div className="modal-overlay" onClick={() => { if (!editPasswordLoading) { setPendingEditTrainee(null); setEditPassword(""); setEditPasswordError(""); } }}>
          <div className="modal-content" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginBottom: "0.25rem" }}>Edit Trainee</h2>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
              Enter <strong>{pendingEditTrainee.displayName}&apos;s</strong> password to continue.
            </p>
            <div className="form-group" style={{ marginBottom: "0.75rem" }}>
              <label>Password</label>
              <input
                type="password"
                placeholder="••••••••"
                value={editPassword}
                onChange={(e) => { setEditPassword(e.target.value); setEditPasswordError(""); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (!editPassword.trim()) return;
                    setEditPasswordLoading(true);
                    setEditPasswordError("");
                    verifyPassword(pendingEditTrainee!.id, editPassword)
                      .then(() => {
                        setEditingTrainee(pendingEditTrainee);
                        setPendingEditTrainee(null);
                        setEditPassword("");
                        setEditPasswordError("");
                      })
                      .catch((err: unknown) => setEditPasswordError(err instanceof Error ? err.message : "Incorrect password."))
                      .finally(() => setEditPasswordLoading(false));
                  }
                }}
                autoFocus
              />
            </div>
            {editPasswordError && (
              <p style={{ color: "var(--danger)", fontSize: "0.85rem", marginBottom: "0.75rem" }}>{editPasswordError}</p>
            )}
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button className="btn btn-outline" onClick={() => { setPendingEditTrainee(null); setEditPassword(""); setEditPasswordError(""); }} disabled={editPasswordLoading}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={editPasswordLoading || !editPassword.trim()}
                onClick={() => {
                  setEditPasswordLoading(true);
                  setEditPasswordError("");
                  verifyPassword(pendingEditTrainee!.id, editPassword)
                    .then(() => {
                      setEditingTrainee(pendingEditTrainee);
                      setPendingEditTrainee(null);
                      setEditPassword("");
                      setEditPasswordError("");
                    })
                    .catch((err: unknown) => setEditPasswordError(err instanceof Error ? err.message : "Incorrect password."))
                    .finally(() => setEditPasswordLoading(false));
                }}
              >
                {editPasswordLoading ? "Verifying…" : "Continue"}
              </button>
            </div>
          </div>
        </div>
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

      {/* Delete trainee confirmation modal */}
      {deletingTrainee && (() => {
        const t = deletingTrainee;
        const pct = Math.min(100, Math.round((t.totalHoursRendered / t.requiredHours) * 100));
        return (
          <div className="modal-overlay" onClick={closeDeletingModal}>
            <div className="modal-content" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
              <h2 style={{ marginBottom: "0.25rem", color: "var(--danger)" }}>Delete Trainee</h2>
              <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
                Are you sure you want to permanently delete this trainee and <strong>all</strong> their logs and supervisors?
              </p>

              <div style={{ background: "var(--bg)", borderRadius: "6px", padding: "0.75rem 1rem", marginBottom: "1rem", fontSize: "0.88rem" }}>
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.3rem 0.75rem" }}>
                  <strong>Name:</strong>
                  <span>{t.displayName}</span>
                  <strong>School:</strong>
                  <span>{t.school}</span>
                  {t.companyName && (
                    <>
                      <strong>Company:</strong>
                      <span>{t.companyName}</span>
                    </>
                  )}
                  <strong>Progress:</strong>
                  <span>{t.totalHoursRendered.toFixed(1)} / {t.requiredHours} hrs ({pct}%)</span>
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: "1rem" }}>
                <label style={{ fontSize: "0.85rem", fontWeight: 600 }}>Enter trainee&apos;s password to confirm deletion</label>
                <input
                  type="password"
                  placeholder="Password"
                  value={deletePassword}
                  onChange={(e) => { setDeletePassword(e.target.value); setDeleteError(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleDelete(); } }}
                  autoFocus
                />
              </div>

              {deleteError && (
                <p style={{ color: "var(--danger)", fontSize: "0.85rem", marginBottom: "0.75rem" }}>{deleteError}</p>
              )}

              <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                <button className="btn btn-outline" onClick={closeDeletingModal} disabled={deleteLoading}>
                  Cancel
                </button>
                <button className="btn btn-danger" onClick={handleDelete} disabled={deleteLoading || !deletePassword.trim()}>
                  {deleteLoading ? "Verifying…" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Delete success modal */}
      {deleteSuccess && (
        <div className="modal-overlay" onClick={() => setDeleteSuccess(null)}>
          <div className="modal-content" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginBottom: "0.5rem", color: "#16a34a" }}>Trainee Deleted</h2>
            <p style={{ fontSize: "0.9rem", marginBottom: "1rem" }}>
              <strong>{deleteSuccess}</strong> and all associated logs and supervisors have been permanently deleted.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="btn btn-primary" onClick={() => setDeleteSuccess(null)}>OK</button>
            </div>
          </div>
        </div>
      )}

      {/* Import result modal */}
      {(importResult || importError) && (
        <div className="modal-overlay" onClick={() => { setImportResult(null); setImportError(null); }}>
          <div className="modal-content" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            {importError ? (
              <>
                <h2 style={{ marginBottom: "0.5rem", color: "var(--danger)" }}>Import Failed</h2>
                <p style={{ fontSize: "0.9rem", marginBottom: "1rem" }}>{importError}</p>
              </>
            ) : importResult && (
              <>
                <h2 style={{ marginBottom: "0.5rem", color: "#16a34a" }}>Import Successful</h2>
                <p style={{ fontSize: "0.9rem", marginBottom: "0.75rem" }}>
                  The CSV file has been imported successfully.
                </p>
                <div style={{ background: "var(--bg)", borderRadius: "6px", padding: "0.75rem 1rem", marginBottom: "1rem", fontSize: "0.9rem" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.3rem 0.75rem" }}>
                    <strong>Trainees:</strong>
                    <span>{importResult.trainees}</span>
                    <strong>Supervisors:</strong>
                    <span>{importResult.supervisors}</span>
                    <strong>Log Entries:</strong>
                    <span>{importResult.logs}</span>
                    <strong>Skipped:</strong>
                    <span>{importResult.skipped}</span>
                  </div>
                </div>
              </>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="btn btn-primary" onClick={() => { setImportResult(null); setImportError(null); }}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Super password gate modal for Export / Import */}
      {pendingAction && (
        <div className="modal-overlay" onClick={closeActionModal}>
          <div className="modal-content" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginBottom: "0.25rem" }}>
              {pendingAction === "export" ? "Export All CSV" : "Import CSV"}
            </h2>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
              Enter secret code to proceed.
            </p>
            <div className="form-group" style={{ marginBottom: "0.75rem" }}>
              <label>CODE</label>
              <input
                type="password"
                placeholder="••••••••"
                value={actionPassword}
                onChange={(e) => { setActionPassword(e.target.value); setActionPasswordError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleActionVerify(); } }}
                autoFocus
              />
            </div>
            {actionPasswordError && (
              <p style={{ color: "var(--danger)", fontSize: "0.85rem", marginBottom: "0.75rem" }}>{actionPasswordError}</p>
            )}
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button className="btn btn-outline" onClick={closeActionModal} disabled={actionPasswordLoading}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={actionPasswordLoading || !actionPassword.trim()}
                onClick={handleActionVerify}
              >
                {actionPasswordLoading ? "Verifying…" : "Continue"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export success modal */}
      {exportSuccess && (
        <div className="modal-overlay" onClick={() => setExportSuccess(false)}>
          <div className="modal-content" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginBottom: "0.5rem", color: "#16a34a" }}>Export Successful</h2>
            <p style={{ fontSize: "0.9rem", marginBottom: "1rem" }}>
              All trainee data has been exported to CSV. Your download should begin shortly.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="btn btn-primary" onClick={() => setExportSuccess(false)}>OK</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
