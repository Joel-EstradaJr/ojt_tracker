"use client";

// ============================================================
// Dashboard Page (Landing)
// Shows all trainee cards. Click a card -> password prompt -> logs.
// ============================================================

import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Trainee } from "@/types";
import { fetchTrainees, deleteTrainee, verifyPassword, verifySuperPassword, downloadAllCSV, importAllCSV } from "@/lib/api";
import TraineeCard from "@/components/TraineeCard";
import PasswordModal from "@/components/PasswordModal";
import CreateTraineeForm from "@/components/CreateTraineeForm";
import EditTraineeForm from "@/components/EditTraineeForm";
import { ThemeToggle } from "@/components/ThemeProvider";

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
      // Password correct - proceed with deletion
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
      {/* Hero Header */}
      <div className="hero-header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <h1>OJT Progress Tracker  :  for Nerie Ann Ganda</h1>
            <p>Manage trainee hours, accomplishments, and progress reports</p>
          </div>
          <ThemeToggle />
        </div>

        <div className="hero-actions" style={{ marginTop: "1.25rem" }}>
          <button className="btn" onClick={() => setPendingAction("export")}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Export All
          </button>
          <button
            className="btn"
            onClick={() => setPendingAction("import")}
            disabled={importLoading}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            {importLoading ? "Importing..." : "Import CSV"}
          </button>
          <input
            type="file"
            accept=".csv"
            ref={importRef}
            style={{ display: "none" }}
            onChange={handleImportAll}
          />
          <button className="btn btn-add" onClick={() => setShowCreate(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Trainee
          </button>
        </div>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="skeleton">
          <div className="trainee-grid">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton-card">
                <div className="skeleton-line medium" />
                <div className="skeleton-line short" />
                <div className="skeleton-line" />
                <div className="skeleton-line thin" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && trainees.length === 0 && (
        <motion.div
          className="empty-state"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <div className="empty-state-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <h3>No Trainees Yet</h3>
          <p>Get started by adding your first trainee. Click the <strong>Add Trainee</strong> button above to begin tracking OJT progress.</p>
        </motion.div>
      )}

      {/* Trainee cards grid */}
      <div className="trainee-grid">
        <AnimatePresence>
          {trainees.map((t, idx) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.3, delay: idx * 0.05 }}
            >
              <TraineeCard
                trainee={t}
                onClick={() => setSelectedId(t.id)}
                onEdit={() => setPendingEditTrainee(t)}
                onDelete={() => setDeletingTrainee(t)}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Password modal - shown when a card is clicked */}
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
          <div className="modal-content" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
              <div style={{ width: "2.5rem", height: "2.5rem", borderRadius: "var(--radius-sm)", background: "var(--primary-light)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              </div>
              <div>
                <h2 style={{ fontSize: "1.15rem", marginBottom: "0.1rem" }}>Edit Trainee</h2>
                <p style={{ fontSize: "0.84rem", color: "var(--text-muted)" }}>
                  Enter <strong>{pendingEditTrainee.displayName}&apos;s</strong> password
                </p>
              </div>
            </div>
            <div className="form-group" style={{ marginBottom: "0.75rem" }}>
              <label>Password</label>
              <input
                type="password"
                placeholder="Enter password"
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
              <div style={{ background: "var(--danger-light)", border: "1px solid var(--danger)", borderRadius: "var(--radius-xs)", padding: "0.5rem 0.75rem", marginBottom: "0.75rem" }}>
                <p style={{ color: "var(--danger)", fontSize: "0.84rem", margin: 0 }}>{editPasswordError}</p>
              </div>
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
                {editPasswordLoading ? "Verifying..." : "Continue"}
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
            <div className="modal-content" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
                <div style={{ width: "2.5rem", height: "2.5rem", borderRadius: "var(--radius-sm)", background: "var(--danger-light)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                </div>
                <div>
                  <h2 style={{ fontSize: "1.15rem", marginBottom: "0.1rem", color: "var(--danger)" }}>Delete Trainee</h2>
                  <p style={{ fontSize: "0.84rem", color: "var(--text-muted)" }}>
                    This action is permanent and cannot be undone.
                  </p>
                </div>
              </div>

              <div style={{ background: "var(--bg-subtle)", borderRadius: "var(--radius-sm)", padding: "0.85rem 1rem", marginBottom: "1rem", fontSize: "0.88rem" }}>
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.35rem 0.75rem" }}>
                  <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>Name:</span>
                  <span style={{ fontWeight: 600 }}>{t.displayName}</span>
                  <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>School:</span>
                  <span>{t.school}</span>
                  {t.companyName && (
                    <>
                      <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>Company:</span>
                      <span>{t.companyName}</span>
                    </>
                  )}
                  <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>Progress:</span>
                  <span>{t.totalHoursRendered.toFixed(1)} / {t.requiredHours} hrs ({pct}%)</span>
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: "1rem" }}>
                <label>Enter trainee&apos;s password to confirm deletion</label>
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
                <div style={{ background: "var(--danger-light)", border: "1px solid var(--danger)", borderRadius: "var(--radius-xs)", padding: "0.5rem 0.75rem", marginBottom: "0.75rem" }}>
                  <p style={{ color: "var(--danger)", fontSize: "0.84rem", margin: 0 }}>{deleteError}</p>
                </div>
              )}

              <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                <button className="btn btn-outline" onClick={closeDeletingModal} disabled={deleteLoading}>
                  Cancel
                </button>
                <button className="btn btn-danger" onClick={handleDelete} disabled={deleteLoading || !deletePassword.trim()}>
                  {deleteLoading ? "Verifying..." : "Delete Permanently"}
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
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
              <div style={{ width: "2.5rem", height: "2.5rem", borderRadius: "var(--radius-sm)", background: "var(--success-light)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <div>
                <h2 style={{ fontSize: "1.15rem", marginBottom: "0.1rem", color: "var(--success-text)" }}>Trainee Deleted</h2>
              </div>
            </div>
            <p style={{ fontSize: "0.9rem", marginBottom: "1.25rem", color: "var(--text-secondary)" }}>
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
          <div className="modal-content" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            {importError ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
                  <div style={{ width: "2.5rem", height: "2.5rem", borderRadius: "var(--radius-sm)", background: "var(--danger-light)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                  </div>
                  <h2 style={{ fontSize: "1.15rem", color: "var(--danger)" }}>Import Failed</h2>
                </div>
                <p style={{ fontSize: "0.9rem", marginBottom: "1.25rem", color: "var(--text-secondary)" }}>{importError}</p>
              </>
            ) : importResult && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
                  <div style={{ width: "2.5rem", height: "2.5rem", borderRadius: "var(--radius-sm)", background: "var(--success-light)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <h2 style={{ fontSize: "1.15rem", color: "var(--success-text)" }}>Import Successful</h2>
                </div>
                <p style={{ fontSize: "0.9rem", marginBottom: "0.75rem", color: "var(--text-secondary)" }}>
                  The CSV file has been imported successfully.
                </p>
                <div className="stat-row" style={{ marginBottom: "1.25rem" }}>
                  <div className="stat-item">
                    <div className="label">Trainees</div>
                    <div className="value">{importResult.trainees}</div>
                  </div>
                  <div className="stat-item">
                    <div className="label">Supervisors</div>
                    <div className="value">{importResult.supervisors}</div>
                  </div>
                  <div className="stat-item">
                    <div className="label">Log Entries</div>
                    <div className="value">{importResult.logs}</div>
                  </div>
                  <div className="stat-item">
                    <div className="label">Skipped</div>
                    <div className="value">{importResult.skipped}</div>
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
          <div className="modal-content" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
              <div style={{ width: "2.5rem", height: "2.5rem", borderRadius: "var(--radius-sm)", background: "var(--primary-light)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              </div>
              <div>
                <h2 style={{ fontSize: "1.15rem", marginBottom: "0.1rem" }}>
                  {pendingAction === "export" ? "Export All CSV" : "Import CSV"}
                </h2>
                <p style={{ fontSize: "0.84rem", color: "var(--text-muted)" }}>
                  Enter the secret code to proceed
                </p>
              </div>
            </div>
            <div className="form-group" style={{ marginBottom: "0.75rem" }}>
              <label>Code</label>
              <input
                type="password"
                placeholder="Enter secret code"
                value={actionPassword}
                onChange={(e) => { setActionPassword(e.target.value); setActionPasswordError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleActionVerify(); } }}
                autoFocus
              />
            </div>
            {actionPasswordError && (
              <div style={{ background: "var(--danger-light)", border: "1px solid var(--danger)", borderRadius: "var(--radius-xs)", padding: "0.5rem 0.75rem", marginBottom: "0.75rem" }}>
                <p style={{ color: "var(--danger)", fontSize: "0.84rem", margin: 0 }}>{actionPasswordError}</p>
              </div>
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
                {actionPasswordLoading ? "Verifying..." : "Continue"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export success modal */}
      {exportSuccess && (
        <div className="modal-overlay" onClick={() => setExportSuccess(false)}>
          <div className="modal-content" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
              <div style={{ width: "2.5rem", height: "2.5rem", borderRadius: "var(--radius-sm)", background: "var(--success-light)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <h2 style={{ fontSize: "1.15rem", color: "var(--success-text)" }}>Export Successful</h2>
            </div>
            <p style={{ fontSize: "0.9rem", marginBottom: "1.25rem", color: "var(--text-secondary)" }}>
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
