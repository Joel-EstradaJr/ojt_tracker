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
import { formatMinutes } from "@/lib/duration";
import { useActionGuard } from "@/lib/useActionGuard";
import { fetchTrainees, deleteTrainee, downloadAllCSV, importAllCSV, getSession } from "@/lib/api";
import TraineeCard from "@/components/TraineeCard";
import EditTraineeForm from "@/components/EditTraineeForm";
import DatePicker from "@/components/DatePicker";
import { ThemeToggle } from "@/components/ThemeProvider";
import PageHeading from "@/components/PageHeading";

export default function HomePage() {
  const router = useRouter();
  const { runGuarded } = useActionGuard();

  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [activeAdminLabel, setActiveAdminLabel] = useState("");
  const [editingTrainee, setEditingTrainee] = useState<Trainee | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
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
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deletePassword, setDeletePassword] = useState("");

  // Search, sort & pagination
  const [searchQuery, setSearchQuery] = useState("");
  const [showSortModal, setShowSortModal] = useState(false);
  const [sortField, setSortField] = useState<"name" | "role" | "createdAt" | "hoursRendered" | "hoursRemaining" | "expectedEnd" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [draftSortField, setDraftSortField] = useState<"name" | "role" | "createdAt" | "hoursRendered" | "hoursRemaining" | "expectedEnd" | null>(null);
  const [draftSortDir, setDraftSortDir] = useState<"asc" | "desc">("asc");
  const [showFiltersModal, setShowFiltersModal] = useState(false);
  const [expectedEndFrom, setExpectedEndFrom] = useState("");
  const [expectedEndTo, setExpectedEndTo] = useState("");
  const [requiredHoursMin, setRequiredHoursMin] = useState("");
  const [requiredHoursMax, setRequiredHoursMax] = useState("");
  const [totalWorkedMin, setTotalWorkedMin] = useState("");
  const [totalWorkedMax, setTotalWorkedMax] = useState("");
  const [draftExpectedEndFrom, setDraftExpectedEndFrom] = useState("");
  const [draftExpectedEndTo, setDraftExpectedEndTo] = useState("");
  const [draftRequiredHoursMin, setDraftRequiredHoursMin] = useState("");
  const [draftRequiredHoursMax, setDraftRequiredHoursMax] = useState("");
  const [draftTotalWorkedMin, setDraftTotalWorkedMin] = useState("");
  const [draftTotalWorkedMax, setDraftTotalWorkedMax] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [cardsPerPage, setCardsPerPage] = useState(12);

  const normalizeDeleteConfirmation = (value: string) => value.trim().replace(/\s+/g, " ").toUpperCase();

  const openSortModal = () => {
    setDraftSortField(sortField);
    setDraftSortDir(sortDir);
    setShowSortModal(true);
  };

  const applySort = () => {
    setSortField(draftSortField);
    setSortDir(draftSortDir);
    setCurrentPage(1);
    setShowSortModal(false);
  };

  const clearSort = () => {
    setSortField(null);
    setSortDir("asc");
    setDraftSortField(null);
    setDraftSortDir("asc");
    setCurrentPage(1);
    setShowSortModal(false);
  };

  const openFiltersModal = () => {
    setDraftExpectedEndFrom(expectedEndFrom);
    setDraftExpectedEndTo(expectedEndTo);
    setDraftRequiredHoursMin(requiredHoursMin);
    setDraftRequiredHoursMax(requiredHoursMax);
    setDraftTotalWorkedMin(totalWorkedMin);
    setDraftTotalWorkedMax(totalWorkedMax);
    setShowFiltersModal(true);
  };

  const applyFilters = () => {
    setExpectedEndFrom(draftExpectedEndFrom);
    setExpectedEndTo(draftExpectedEndTo);
    setRequiredHoursMin(draftRequiredHoursMin);
    setRequiredHoursMax(draftRequiredHoursMax);
    setTotalWorkedMin(draftTotalWorkedMin);
    setTotalWorkedMax(draftTotalWorkedMax);
    setCurrentPage(1);
    setShowFiltersModal(false);
  };

  const clearAllFilters = () => {
    setExpectedEndFrom("");
    setExpectedEndTo("");
    setRequiredHoursMin("");
    setRequiredHoursMax("");
    setTotalWorkedMin("");
    setTotalWorkedMax("");
    setDraftExpectedEndFrom("");
    setDraftExpectedEndTo("");
    setDraftRequiredHoursMin("");
    setDraftRequiredHoursMax("");
    setDraftTotalWorkedMin("");
    setDraftTotalWorkedMax("");
    setCurrentPage(1);
    setShowFiltersModal(false);
  };

  const activeFilterCount =
    Number(Boolean(expectedEndFrom)) +
    Number(Boolean(expectedEndTo)) +
    Number(Boolean(requiredHoursMin)) +
    Number(Boolean(requiredHoursMax)) +
    Number(Boolean(totalWorkedMin)) +
    Number(Boolean(totalWorkedMax));

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
          if (session.traineeId) router.replace(`/trainee/${session.traineeId}/dashboard`);
          else router.replace("/login");
          return;
        }

        if (session.role === "admin") {
          const displayName = session.currentUser?.displayName || "Admin";
          const email = session.currentUser?.email;
          setActiveAdminLabel(email ? `${displayName} (${email})` : displayName);
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

  const handleExportAll = async () => {
    await runGuarded("admin-trainee-export-all", async () => {
      setExportLoading(true);
      try {
        downloadAllCSV();
        setExportSuccess(true);
      } finally {
        setExportLoading(false);
      }
    });
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
    await runGuarded("admin-trainee-delete", async () => {
      if (!deletingTrainee) return;
      setDeleteLoading(true);
      setDeleteError("");
      try {
        const name = deletingTrainee.displayName;
        await deleteTrainee(deletingTrainee.id, {
          currentPassword: deletingTrainee.role === "admin" ? deletePassword : undefined,
          typedConfirmation: deletingTrainee.role === "admin" ? deleteConfirmText : undefined,
        });
        setDeletingTrainee(null);
        setDeleteConfirmText("");
        setDeletePassword("");
        setDeleteError("");
        setDeleteSuccess(name);
        loadTrainees();
      } catch (err) {
        setDeleteError(err instanceof Error ? err.message : "Failed to delete user.");
      } finally {
        setDeleteLoading(false);
      }
    });
  };

  const closeDeletingModal = () => {
    if (!deleteLoading) {
      setDeletingTrainee(null);
      setDeleteError("");
      setDeleteConfirmText("");
      setDeletePassword("");
    }
  };

  const handleImportAll = async (e: React.ChangeEvent<HTMLInputElement>) => {
    await runGuarded("admin-trainee-import", async () => {
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
    });
  };



  // Helper: compute expected end date as timestamp for sorting
  const getExpectedEndTs = (t: Trainee) => {
    const requiredMinutes = t.requiredHours * 60;
    const remainingMinutes = Math.max(0, requiredMinutes - t.totalHoursRendered);
    if (remainingMinutes === 0) return Infinity;
    return calculateExpectedEndDate(remainingMinutes / 60, undefined, t.workSchedule).getTime();
  };

  const getExpectedEndDate = (t: Trainee): Date | null => {
    const requiredMinutes = t.requiredHours * 60;
    const remainingMinutes = Math.max(0, requiredMinutes - t.totalHoursRendered);
    if (remainingMinutes === 0) return null;
    return calculateExpectedEndDate(remainingMinutes / 60, undefined, t.workSchedule);
  };

  // Filter trainees by searchable fields and modal filter ranges
  const trackableTrainees = trainees.filter((t) => t.role === "trainee");
  const q = searchQuery.toLowerCase().trim();
  const filteredTrainees = trackableTrainees
    .filter((t) => {
      const matchesSearch = !q ||
        t.displayName.toLowerCase().includes(q) ||
        t.school.toLowerCase().includes(q) ||
        t.companyName.toLowerCase().includes(q) ||
        String(t.requiredHours).includes(q);

      if (!matchesSearch) return false;

      const expectedEnd = getExpectedEndDate(t);
      if (expectedEndFrom) {
        if (!expectedEnd) return false;
        const from = new Date(`${expectedEndFrom}T00:00:00`);
        if (expectedEnd < from) return false;
      }
      if (expectedEndTo) {
        if (!expectedEnd) return false;
        const to = new Date(`${expectedEndTo}T23:59:59.999`);
        if (expectedEnd > to) return false;
      }

      const reqHours = t.requiredHours;
      if (requiredHoursMin !== "" && reqHours < Number(requiredHoursMin)) return false;
      if (requiredHoursMax !== "" && reqHours > Number(requiredHoursMax)) return false;

      const totalWorkedHours = t.totalHoursRendered / 60;
      if (totalWorkedMin !== "" && totalWorkedHours < Number(totalWorkedMin)) return false;
      if (totalWorkedMax !== "" && totalWorkedHours > Number(totalWorkedMax)) return false;

      return true;
    });

  const sortedTrainees = !sortField
    ? filteredTrainees
    : [...filteredTrainees].sort((a, b) => {
        let cmp = 0;
        switch (sortField) {
          case "name":
            cmp = a.displayName.localeCompare(b.displayName);
            break;
          case "role":
            cmp = a.role.localeCompare(b.role);
            break;
          case "createdAt":
            cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
            break;
          case "hoursRendered":
            cmp = a.totalHoursRendered - b.totalHoursRendered;
            break;
          case "hoursRemaining":
            cmp = ((a.requiredHours * 60) - a.totalHoursRendered) - ((b.requiredHours * 60) - b.totalHoursRendered);
            break;
          case "expectedEnd":
            cmp = getExpectedEndTs(a) - getExpectedEndTs(b);
            break;
        }
        return sortDir === "asc" ? cmp : -cmp;
      });

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sortedTrainees.length / cardsPerPage));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedTrainees = sortedTrainees.slice((safePage - 1) * cardsPerPage, safePage * cardsPerPage);

  return (
    <div className="container">
      <PageHeading
        title="Trainee Management"
        subtitle="Track trainee hours, accomplishments, and progress reports."
        actions={(
          <>
            <ThemeToggle />
          </>
        )}
        toolbar={(
          <>
            <button className="btn" onClick={handleExportAll} disabled={exportLoading}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              {exportLoading ? "Exporting..." : "Export All"}
            </button>
            <button className="btn" onClick={() => importRef.current?.click()} disabled={importLoading}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
              {importLoading ? "Importing..." : "Import CSV"}
            </button>
            <input type="file" accept=".csv" ref={importRef} style={{ display: "none" }} onChange={handleImportAll} />
          </>
        )}
        meta={<>LOGGED IN AS: <strong style={{ color: "var(--text)" }}>{activeAdminLabel || "Admin"}</strong></>}
      />

      {/* Search, Sort & Pagination bar */}
      {!loading && trackableTrainees.length > 0 && (
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap" }}>
          {/* Search */}
          <div className="form-group" style={{ position: "relative", flex: "1 1 260px", minWidth: "220px", marginBottom: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: "absolute", left: "0.75rem", top: "50%", transform: "translateY(-50%)", opacity: 0.4, pointerEvents: "none" }}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input
              type="text"
              placeholder="Search full name, school, company, required hours..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              style={{ paddingLeft: "2.25rem" }}
            />
          </div>

          <button className="btn btn-outline" onClick={openFiltersModal} style={{ fontSize: "0.82rem", padding: "0.5rem 0.75rem", whiteSpace: "nowrap" }}>
            Filters {activeFilterCount > 0 ? `(${activeFilterCount})` : ""}
          </button>

          <button className="btn btn-outline" onClick={openSortModal} style={{ fontSize: "0.82rem", padding: "0.5rem 0.75rem", whiteSpace: "nowrap" }}>
            Sort {sortField ? `(${sortDir === "asc" ? "Asc" : "Desc"})` : ""}
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
      {!loading && trackableTrainees.length === 0 && (
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
          <p>No trainee records are available yet.</p>
        </motion.div>
      )}

      {/* No search results */}
      {!loading && trackableTrainees.length > 0 && filteredTrainees.length === 0 && (
        <div style={{ textAlign: "center", padding: "2rem 1rem", color: "var(--text-muted)" }}>
          <p style={{ fontSize: "0.95rem" }}>No trainees match the current search and filters.</p>
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
                onClick={() => router.push(`/trainee/${t.id}/entry-logs?from=admin`)}
                onEdit={() => setEditingTrainee(t)}
                onDelete={() => setDeletingTrainee(t)}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>


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
        const requiredMinutes = t.requiredHours * 60;
        const pct = Math.min(100, Math.round((t.totalHoursRendered / Math.max(1, requiredMinutes)) * 100));
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
                  <span>{formatMinutes(t.totalHoursRendered)} / {formatMinutes(requiredMinutes)} ({pct}%)</span>
                </div>
              </div>

              {t.role === "admin" && (
                <div style={{ background: "var(--warning-light)", border: "1px solid var(--warning)", borderRadius: "var(--radius-sm)", padding: "0.8rem", marginBottom: "1rem" }}>
                  {(() => {
                    const requiredPhrase = `DELETE ${t.displayName}`;
                    return (
                      <>
                  <p style={{ margin: "0 0 0.55rem 0", fontSize: "0.82rem", color: "var(--text-secondary)" }}>
                    Admin deletion requires confirmation.
                  </p>
                  <div className="form-group" style={{ marginBottom: "0.55rem" }}>
                    <label htmlFor="deleteAdminPassword">Your Current Password</label>
                    <input
                      id="deleteAdminPassword"
                      type="password"
                      value={deletePassword}
                      onChange={(e) => setDeletePassword(e.target.value)}
                      placeholder="Enter your password"
                      autoComplete="current-password"
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label htmlFor="deleteAdminPhrase">Type "{requiredPhrase}" to confirm</label>
                    <input
                      id="deleteAdminPhrase"
                      type="text"
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      placeholder={requiredPhrase}
                    />
                  </div>
                      </>
                    );
                  })()}
                </div>
              )}

              {deleteError && (
                <div style={{ background: "var(--danger-light)", border: "1px solid var(--danger)", borderRadius: "var(--radius-xs)", padding: "0.5rem 0.75rem", marginBottom: "0.75rem" }}>
                  <p style={{ color: "var(--danger)", fontSize: "0.84rem", margin: 0 }}>{deleteError}</p>
                </div>
              )}

              <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                <button className="btn btn-outline" onClick={closeDeletingModal} disabled={deleteLoading}>
                  Cancel
                </button>
                <button
                  className="btn btn-danger"
                  onClick={handleDelete}
                  disabled={
                    deleteLoading ||
                    (t.role === "admin" && (!deletePassword.trim() || normalizeDeleteConfirmation(deleteConfirmText) !== normalizeDeleteConfirmation(`DELETE ${t.displayName}`)))
                  }
                >
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

      {/* Filters modal */}
      {showFiltersModal && (
        <div className="modal-overlay" onClick={() => setShowFiltersModal(false)}>
          <div className="modal-content" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.9rem" }}>
              <h2 style={{ fontSize: "1.1rem", margin: 0 }}>Trainee Filters</h2>
            </div>

            <div style={{ display: "grid", gap: "0.9rem", marginBottom: "1rem" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.6rem" }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label htmlFor="expectedEndFrom">Expected End Date From</label>
                  <DatePicker value={draftExpectedEndFrom} onChange={setDraftExpectedEndFrom} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label htmlFor="expectedEndTo">Expected End Date To</label>
                  <DatePicker value={draftExpectedEndTo} onChange={setDraftExpectedEndTo} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.6rem" }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label htmlFor="requiredHoursMin">Required Hours Min</label>
                  <input
                    id="requiredHoursMin"
                    type="number"
                    min="0"
                    step="1"
                    value={draftRequiredHoursMin}
                    onChange={(e) => setDraftRequiredHoursMin(e.target.value)}
                    placeholder="e.g., 120"
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label htmlFor="requiredHoursMax">Required Hours Max</label>
                  <input
                    id="requiredHoursMax"
                    type="number"
                    min="0"
                    step="1"
                    value={draftRequiredHoursMax}
                    onChange={(e) => setDraftRequiredHoursMax(e.target.value)}
                    placeholder="e.g., 486"
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.6rem" }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label htmlFor="totalWorkedMin">Total Hours Worked Min</label>
                  <input
                    id="totalWorkedMin"
                    type="number"
                    min="0"
                    step="0.5"
                    value={draftTotalWorkedMin}
                    onChange={(e) => setDraftTotalWorkedMin(e.target.value)}
                    placeholder="e.g., 40"
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label htmlFor="totalWorkedMax">Total Hours Worked Max</label>
                  <input
                    id="totalWorkedMax"
                    type="number"
                    min="0"
                    step="0.5"
                    value={draftTotalWorkedMax}
                    onChange={(e) => setDraftTotalWorkedMax(e.target.value)}
                    placeholder="e.g., 300"
                  />
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.6rem" }}>
              <button className="btn btn-outline" onClick={clearAllFilters}>Clear All</button>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button className="btn btn-outline" onClick={() => setShowFiltersModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={applyFilters}>Apply Filters</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sort modal */}
      {showSortModal && (
        <div className="modal-overlay" onClick={() => setShowSortModal(false)}>
          <div className="modal-content" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.9rem" }}>
              <h2 style={{ fontSize: "1.1rem", margin: 0 }}>Sort Trainees</h2>
            </div>

            <div style={{ display: "grid", gap: "0.9rem", marginBottom: "1rem" }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="sortField">Sort Field</label>
                <select
                  id="sortField"
                  value={draftSortField ?? ""}
                  onChange={(e) => setDraftSortField((e.target.value || null) as typeof draftSortField)}
                >
                  <option value="">No Sort</option>
                  <option value="name">Full Name</option>
                  <option value="role">Role</option>
                  <option value="createdAt">Created At</option>
                  <option value="hoursRendered">Total Hours Worked</option>
                  <option value="hoursRemaining">Hours Remaining</option>
                  <option value="expectedEnd">Expected End Date</option>
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ marginBottom: "0.45rem" }}>Sort Direction</label>
                <div style={{ display: "flex", gap: "0.65rem", flexWrap: "wrap" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.9rem", color: "var(--text-secondary)" }}>
                    <input
                      type="radio"
                      name="sortDirection"
                      checked={draftSortDir === "asc"}
                      onChange={() => setDraftSortDir("asc")}
                    />
                    Ascending
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.9rem", color: "var(--text-secondary)" }}>
                    <input
                      type="radio"
                      name="sortDirection"
                      checked={draftSortDir === "desc"}
                      onChange={() => setDraftSortDir("desc")}
                    />
                    Descending
                  </label>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.6rem" }}>
              <button className="btn btn-outline" onClick={clearSort}>Clear</button>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button className="btn btn-outline" onClick={() => setShowSortModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={applySort}>Apply</button>
              </div>
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
