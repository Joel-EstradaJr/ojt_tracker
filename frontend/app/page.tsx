"use client";

// ============================================================
// Dashboard Page (Landing)
// Shows all trainee cards. Click a card -> password prompt -> logs.
// ============================================================

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Trainee } from "@/types";
import { calculateExpectedEndDate } from "@/lib/ph-holidays";
import { fetchTrainees, deleteTrainee, downloadAllCSV, importAllCSV, getSession, logout } from "@/lib/api";
import TraineeCard from "@/components/TraineeCard";
import CreateTraineeForm from "@/components/CreateTraineeForm";
import EditTraineeForm from "@/components/EditTraineeForm";
import { ThemeToggle } from "@/components/ThemeProvider";

export default function HomePage() {
  const router = useRouter();

  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editingTrainee, setEditingTrainee] = useState<Trainee | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  const [exportSuccess, setExportSuccess] = useState(false);

  // Import result modal
  const [importResult, setImportResult] = useState<{ trainees: number; supervisors: number; logs: number; skipped: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Delete confirmation modal
  const [deletingTrainee, setDeletingTrainee] = useState<Trainee | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null);

  // Search, sort & pagination
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<"name" | "createdAt" | "hoursRendered" | "hoursRemaining" | "expectedEnd">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [currentPage, setCurrentPage] = useState(1);
  const [cardsPerPage, setCardsPerPage] = useState(12);

  // Fetch all trainees on mount
  const loadTrainees = useCallback(async () => {
    try {
      const data = await fetchTrainees();
      setTrainees(data);
    } catch (err) {
      console.error("Failed to fetch trainees:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const session = await getSession();
        if (cancelled) return;

        if (!session.authenticated) {
          router.replace("/login");
          return;
        }

        if (session.role === "trainee") {
          if (session.traineeId) router.replace(`/trainee/${session.traineeId}`);
          else router.replace("/login");
          return;
        }

        setAuthorized(true);
        await loadTrainees();
      } catch {
        if (!cancelled) router.replace("/login");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadTrainees, router]);

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // ignore and redirect
    }
    router.replace("/login");
  };

  if (!authorized) {
    return (
      <div className="container">
        <div className="skeleton">
          <div className="skeleton-card" style={{ height: "120px" }}>
            <div className="skeleton-line medium" />
            <div className="skeleton-line short" />
          </div>
        </div>
      </div>
    );
  }

  const handleDelete = async () => {
    if (!deletingTrainee) return;
    setDeleteLoading(true);
    setDeleteError("");
    try {
      const name = deletingTrainee.displayName;
      await deleteTrainee(deletingTrainee.id);
      setDeletingTrainee(null);
      setDeleteError("");
      setDeleteSuccess(name);
      loadTrainees();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete user.");
    } finally {
      setDeleteLoading(false);
    }
  };

  const closeDeletingModal = () => {
    if (!deleteLoading) {
      setDeletingTrainee(null);
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



  // Helper: compute expected end date as timestamp for sorting
  const getExpectedEndTs = (t: Trainee) => {
    const remaining = Math.max(0, t.requiredHours - t.totalHoursRendered);
    if (remaining === 0) return Infinity; // completed trainees sort last/first
    const days = Math.ceil(remaining / 8);
    return calculateExpectedEndDate(days).getTime();
  };

  // Filter trainees by name, school, or company
  const q = searchQuery.toLowerCase();
  const filteredTrainees = trainees
    .filter((t) =>
      t.displayName.toLowerCase().includes(q) ||
      t.school.toLowerCase().includes(q) ||
      t.companyName.toLowerCase().includes(q)
    )
    .sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name":
          cmp = a.displayName.localeCompare(b.displayName);
          break;
        case "createdAt":
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case "hoursRendered":
          cmp = a.totalHoursRendered - b.totalHoursRendered;
          break;
        case "hoursRemaining":
          cmp = (a.requiredHours - a.totalHoursRendered) - (b.requiredHours - b.totalHoursRendered);
          break;
        case "expectedEnd":
          cmp = getExpectedEndTs(a) - getExpectedEndTs(b);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredTrainees.length / cardsPerPage));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedTrainees = filteredTrainees.slice((safePage - 1) * cardsPerPage, safePage * cardsPerPage);

  return (
    <div className="container">
      {/* Hero Header */}
      <div className="hero-header">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <h1>OJT Progress Tracker</h1>
            <p>Manage trainee hours, accomplishments, and progress reports</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <ThemeToggle />
            <button className="btn btn-outline" onClick={handleLogout} style={{ gap: "0.35rem" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
              Log Out
            </button>
          </div>
        </div>

        <div className="hero-actions" style={{ marginTop: "1.25rem" }}>
          <button className="btn" onClick={() => { downloadAllCSV(); setExportSuccess(true); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
            Export All
          </button>
          <button
            className="btn"
            onClick={() => importRef.current?.click()}
            disabled={importLoading}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Add User
          </button>
        </div>
      </div>

      {/* Search, Sort & Pagination bar */}
      {!loading && trainees.length > 0 && (
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap" }}>
          {/* Search */}
          <div style={{ position: "relative", flex: "1 1 220px", maxWidth: "360px", minWidth: "180px" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: "absolute", left: "0.75rem", top: "50%", transform: "translateY(-50%)", opacity: 0.4, pointerEvents: "none" }}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input
              type="text"
              placeholder="Search name, school, or company..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              style={{ paddingLeft: "2.25rem", width: "100%" }}
            />
          </div>

          {/* Sort field dropdown */}
          <select
            className="btn btn-outline"
            value={sortField}
            onChange={(e) => { setSortField(e.target.value as typeof sortField); setCurrentPage(1); }}
            style={{ fontSize: "0.82rem", padding: "0.45rem 0.6rem", cursor: "pointer", background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}
          >
            <option value="name">Sort: Name</option>
            <option value="createdAt">Sort: Created Date</option>
            <option value="hoursRendered">Sort: Hours Rendered</option>
            <option value="hoursRemaining">Sort: Hours Remaining</option>
            <option value="expectedEnd">Sort: Expected End</option>
          </select>

          {/* Sort direction toggle */}
          <button
            className="btn btn-outline"
            style={{ fontSize: "0.82rem", padding: "0.5rem 0.75rem", whiteSpace: "nowrap" }}
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            title={sortDir === "asc" ? "Ascending" : "Descending"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5h10M11 9h7M11 13h4M3 17l3 3 3-3M6 18V4" /></svg>
            {sortDir === "asc" ? "↑ Asc" : "↓ Desc"}
          </button>

          {/* Page size selector + Pagination controls — pushed to the right */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginLeft: "auto", flexShrink: 0 }}>
            <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>Show</span>
            <input
              type="number"
              min="1"
              max="100"
              value={cardsPerPage}
              onChange={(e) => {
                const v = Math.max(1, Math.min(100, parseInt(e.target.value) || 1));
                setCardsPerPage(v);
                setCurrentPage(1);
              }}
              style={{ width: "3.5rem", padding: "0.35rem 0.4rem", fontSize: "0.8rem", textAlign: "center", border: "1px solid var(--border)", borderRadius: "var(--radius-xs)", background: "var(--bg)", color: "var(--text)" }}
            />
            {totalPages > 1 && (
              <>
                <button
                  className="btn btn-outline"
                  style={{ fontSize: "0.78rem", padding: "0.4rem 0.6rem" }}
                  disabled={safePage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                >
                  ‹
                </button>
                <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", whiteSpace: "nowrap", padding: "0 0.15rem" }}>
                  {safePage} / {totalPages}
                </span>
                <button
                  className="btn btn-outline"
                  style={{ fontSize: "0.78rem", padding: "0.4rem 0.6rem" }}
                  disabled={safePage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                >
                  ›
                </button>
              </>
            )}
          </div>
        </div>
      )}

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
          <p>Get started by adding your first user. Click the <strong>Add User</strong> button above to begin tracking OJT progress.</p>
        </motion.div>
      )}

      {/* No search results */}
      {!loading && trainees.length > 0 && filteredTrainees.length === 0 && (
        <div style={{ textAlign: "center", padding: "2rem 1rem", color: "var(--text-muted)" }}>
          <p style={{ fontSize: "0.95rem" }}>No trainees match &ldquo;{searchQuery}&rdquo;</p>
        </div>
      )}

      {/* Trainee cards grid */}
      <div className="trainee-grid">
        <AnimatePresence mode="wait">
          {paginatedTrainees.map((t, idx) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.25, delay: idx * 0.03 }}
              style={{ height: "100%" }}
            >
              <TraineeCard
                trainee={t}
                onClick={() => router.push(`/trainee/${t.id}`)}
                onEdit={() => setEditingTrainee(t)}
                onDelete={() => setDeletingTrainee(t)}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>


      {/* Create trainee modal */}
      {showCreate && (
        <CreateTraineeForm
          title="Add User"
          subtitle="Create an Admin or Trainee account."
          submitLabel="Create User"
          showRoleField
          defaultRole="trainee"
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

      {/* Delete trainee confirmation modal */}
      {deletingTrainee && (() => {
        const t = deletingTrainee;
        const pct = Math.min(100, Math.round((t.totalHoursRendered / t.requiredHours) * 100));
        return (
          <div className="modal-overlay" onClick={closeDeletingModal}>
            <div className="modal-content" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
                <div style={{ width: "2.5rem", height: "2.5rem", borderRadius: "var(--radius-sm)", background: "var(--danger-light)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                </div>
                <div>
                  <h2 style={{ fontSize: "1.15rem", marginBottom: "0.1rem", color: "var(--danger)" }}>Delete User</h2>
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

              {deleteError && (
                <div style={{ background: "var(--danger-light)", border: "1px solid var(--danger)", borderRadius: "var(--radius-xs)", padding: "0.5rem 0.75rem", marginBottom: "0.75rem" }}>
                  <p style={{ color: "var(--danger)", fontSize: "0.84rem", margin: 0 }}>{deleteError}</p>
                </div>
              )}

              <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                <button className="btn btn-outline" onClick={closeDeletingModal} disabled={deleteLoading}>
                  Cancel
                </button>
                <button className="btn btn-danger" onClick={handleDelete} disabled={deleteLoading}>
                  {deleteLoading ? "Deleting..." : "Delete Permanently"}
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
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
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
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
                  </div>
                  <h2 style={{ fontSize: "1.15rem", color: "var(--danger)" }}>Import Failed</h2>
                </div>
                <p style={{ fontSize: "0.9rem", marginBottom: "1.25rem", color: "var(--text-secondary)" }}>{importError}</p>
              </>
            ) : importResult && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
                  <div style={{ width: "2.5rem", height: "2.5rem", borderRadius: "var(--radius-sm)", background: "var(--success-light)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
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



      {/* Export success modal */}
      {exportSuccess && (
        <div className="modal-overlay" onClick={() => setExportSuccess(false)}>
          <div className="modal-content" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
              <div style={{ width: "2.5rem", height: "2.5rem", borderRadius: "var(--radius-sm)", background: "var(--success-light)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
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
