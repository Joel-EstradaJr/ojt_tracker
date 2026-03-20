"use client";

// ============================================================
// Dashboard Page (Landing)
// Shows all trainee cards. Click a card -> password prompt -> logs.
// ============================================================

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Trainee } from "@/types";
import { fetchTrainees, deleteTrainee, downloadAllCSV, importAllCSV, getSession } from "@/lib/api";
import { formatMinutes } from "@/lib/duration";
import { useActionGuard } from "@/lib/useActionGuard";
import CreateTraineeForm from "@/components/CreateTraineeForm";
import EditTraineeForm from "@/components/EditTraineeForm";
import { ThemeToggle } from "@/components/ThemeProvider";
import PageHeading from "@/components/PageHeading";
import { formatDisplayDate } from "@/lib/date";

export default function HomePage() {
  const router = useRouter();
  const { runGuarded } = useActionGuard();

  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [activeAdminLabel, setActiveAdminLabel] = useState("");
  const [showCreate, setShowCreate] = useState(false);
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
  const [sortField, setSortField] = useState<"name" | "role" | "school" | "createdAt" | "activated" | "locked">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [roleFilter, setRoleFilter] = useState<"all" | "admin" | "trainee">("all");
  const [activatedFilter, setActivatedFilter] = useState<"all" | "yes" | "no">("all");
  const [lockedFilter, setLockedFilter] = useState<"all" | "yes" | "no">("all");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [showFiltersModal, setShowFiltersModal] = useState(false);
  const [draftRoleFilter, setDraftRoleFilter] = useState<"all" | "admin" | "trainee">("all");
  const [draftActivatedFilter, setDraftActivatedFilter] = useState<"all" | "yes" | "no">("all");
  const [draftLockedFilter, setDraftLockedFilter] = useState<"all" | "yes" | "no">("all");
  const [draftCreatedFrom, setDraftCreatedFrom] = useState("");
  const [draftCreatedTo, setDraftCreatedTo] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [cardsPerPage, setCardsPerPage] = useState(12);

  const normalizeDeleteConfirmation = (value: string) => value.trim().replace(/\s+/g, " ").toUpperCase();
  const formatFullName = (user: Trainee) => {
    const middle = (user.middleName || "").trim();
    const suffix = (user.suffix || "").trim();
    const middlePart = middle ? ` ${middle}` : "";
    const suffixPart = suffix ? `, ${suffix}` : "";
    return `${user.lastName}, ${user.firstName}${middlePart}${suffixPart}`;
  };
  const formatCreatedAt = (value: string) => {
    return formatDisplayDate(value);
  };
  const isActivated = (user: Trainee) => !user.mustChangePassword;
  const isLocked = (user: Trainee) => {
    if (!user.lockedUntil) return false;
    return new Date(user.lockedUntil).getTime() > Date.now();
  };
  const getCreatedAtParts = (value: string) => {
    const date = new Date(value);
    return {
      day: String(date.getDate()),
      year: String(date.getFullYear()),
      monthLong: date.toLocaleString("en-US", { month: "long" }).toLowerCase(),
      monthShort: date.toLocaleString("en-US", { month: "short" }).toLowerCase(),
    };
  };
  const matchesCreatedAtToken = (value: string, token: string) => {
    const { day, year, monthLong, monthShort } = getCreatedAtParts(value);
    if (/^\d+$/.test(token)) {
      return day.includes(token) || year.includes(token);
    }
    return monthLong.includes(token) || monthShort.includes(token);
  };
  const handleHeaderSort = (field: "name" | "role" | "school" | "createdAt" | "activated" | "locked") => {
    setCurrentPage(1);
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortField(field);
    setSortDir("asc");
  };
  const getSortIndicator = (field: "name" | "role" | "school" | "createdAt" | "activated" | "locked") => {
    if (sortField !== field) return "↕";
    return sortDir === "asc" ? "↑" : "↓";
  };
  const openFiltersModal = () => {
    setDraftRoleFilter(roleFilter);
    setDraftActivatedFilter(activatedFilter);
    setDraftLockedFilter(lockedFilter);
    setDraftCreatedFrom(createdFrom);
    setDraftCreatedTo(createdTo);
    setShowFiltersModal(true);
  };
  const applyFilters = () => {
    setRoleFilter(draftRoleFilter);
    setActivatedFilter(draftActivatedFilter);
    setLockedFilter(draftLockedFilter);
    setCreatedFrom(draftCreatedFrom);
    setCreatedTo(draftCreatedTo);
    setCurrentPage(1);
    setShowFiltersModal(false);
  };
  const clearAllFilters = () => {
    setRoleFilter("all");
    setActivatedFilter("all");
    setLockedFilter("all");
    setCreatedFrom("");
    setCreatedTo("");
    setDraftRoleFilter("all");
    setDraftActivatedFilter("all");
    setDraftLockedFilter("all");
    setDraftCreatedFrom("");
    setDraftCreatedTo("");
    setCurrentPage(1);
    setShowFiltersModal(false);
  };
  const activeFilterCount =
    Number(roleFilter !== "all") +
    Number(activatedFilter !== "all") +
    Number(lockedFilter !== "all") +
    Number(Boolean(createdFrom)) +
    Number(Boolean(createdTo));

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
    await runGuarded("admin-user-export-all", async () => {
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
    await runGuarded("admin-user-delete", async () => {
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
    await runGuarded("admin-user-import", async () => {
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
  // Combined filter + search pipeline
  const searchTokens = searchQuery
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);
  const filteredTrainees = trainees
    .filter((t) => {
      if (roleFilter !== "all" && t.role !== roleFilter) return false;

      const activated = isActivated(t);
      if (activatedFilter === "yes" && !activated) return false;
      if (activatedFilter === "no" && activated) return false;

      const locked = isLocked(t);
      if (lockedFilter === "yes" && !locked) return false;
      if (lockedFilter === "no" && locked) return false;

      const createdAtDate = new Date(t.createdAt);
      if (createdFrom) {
        const from = new Date(`${createdFrom}T00:00:00`);
        if (createdAtDate < from) return false;
      }
      if (createdTo) {
        const to = new Date(`${createdTo}T23:59:59.999`);
        if (createdAtDate > to) return false;
      }

      if (searchTokens.length === 0) return true;

      const searchableValues = [
        formatFullName(t).toLowerCase(),
        t.role.toLowerCase(),
        (t.school || "").toLowerCase(),
        isActivated(t) ? "yes" : "no",
        isLocked(t) ? "yes" : "no",
      ];

      return searchTokens.every((token) => {
        if (searchableValues.some((value) => value.includes(token))) return true;
        return matchesCreatedAtToken(t.createdAt, token);
      });
    })
    .sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name":
          cmp = formatFullName(a).localeCompare(formatFullName(b));
          break;
        case "role":
          cmp = a.role.localeCompare(b.role);
          break;
        case "school":
          cmp = a.school.localeCompare(b.school);
          break;
        case "createdAt":
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          break;
        case "activated":
          cmp = Number(isActivated(a)) - Number(isActivated(b));
          break;
        case "locked":
          cmp = Number(isLocked(a)) - Number(isLocked(b));
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
      <PageHeading
        title="User Management"
        subtitle="Manage admin and trainee accounts."
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
            <button className="btn btn-add" onClick={() => setShowCreate(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              Add User
            </button>
          </>
        )}
        meta={<>LOGGED IN AS: <strong style={{ color: "var(--text)" }}>{activeAdminLabel || "Admin"}</strong></>}
      />

      {/* Search, filters & pagination bar */}
      {!loading && trainees.length > 0 && (
        <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap" }}>
          {/* Search */}
          <div className="form-group" style={{ position: "relative", flex: "1 1 260px", minWidth: "220px", marginBottom: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: "absolute", left: "0.75rem", top: "50%", transform: "translateY(-50%)", opacity: 0.4, pointerEvents: "none" }}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input
              type="text"
              placeholder="Search all columns (name, role, school, date, status)..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              style={{ paddingLeft: "2.25rem" }}
            />
          </div>

          <button className="btn btn-outline" onClick={openFiltersModal} style={{ fontSize: "0.82rem", padding: "0.5rem 0.75rem", whiteSpace: "nowrap" }}>
            Filters {activeFilterCount > 0 ? `(${activeFilterCount})` : ""}
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
          <h3>No Users Yet</h3>
          <p>Get started by adding your first user. Click the <strong>Add User</strong> button above.</p>
        </motion.div>
      )}

      {/* No search results */}
      {!loading && trainees.length > 0 && filteredTrainees.length === 0 && (
        <div style={{ textAlign: "center", padding: "2rem 1rem", color: "var(--text-muted)" }}>
          <p style={{ fontSize: "0.95rem" }}>No users match the current search and filters.</p>
        </div>
      )}

      {/* User management table */}
      {!loading && filteredTrainees.length > 0 && (
        <div style={{ overflowX: "auto", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", marginBottom: "1rem" }}>
          <table className="logs-table">
            <thead>
              <tr>
                <th style={{ textAlign: "center", cursor: "pointer", userSelect: "none" }} onClick={() => handleHeaderSort("name")}>
                  Full Name <span style={{ opacity: 0.7 }}>{getSortIndicator("name")}</span>
                </th>
                <th style={{ textAlign: "center", cursor: "pointer", userSelect: "none" }} onClick={() => handleHeaderSort("role")}>
                  Role <span style={{ opacity: 0.7 }}>{getSortIndicator("role")}</span>
                </th>
                <th style={{ textAlign: "center", cursor: "pointer", userSelect: "none" }} onClick={() => handleHeaderSort("school")}>
                  School / University <span style={{ opacity: 0.7 }}>{getSortIndicator("school")}</span>
                </th>
                <th style={{ textAlign: "center", cursor: "pointer", userSelect: "none" }} onClick={() => handleHeaderSort("createdAt")}>
                  CREATION DATE <span style={{ opacity: 0.7 }}>{getSortIndicator("createdAt")}</span>
                </th>
                <th style={{ textAlign: "center", cursor: "pointer", userSelect: "none" }} onClick={() => handleHeaderSort("activated")}>
                  Activated <span style={{ opacity: 0.7 }}>{getSortIndicator("activated")}</span>
                </th>
                <th style={{ textAlign: "center", cursor: "pointer", userSelect: "none" }} onClick={() => handleHeaderSort("locked")}>
                  Locked <span style={{ opacity: 0.7 }}>{getSortIndicator("locked")}</span>
                </th>
                <th style={{ textAlign: "center" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedTrainees.map((t) => (
                <tr key={t.id} style={{ height: "4.1rem" }}>
                  <td style={{ fontWeight: 600, height: "4.1rem", verticalAlign: "middle", textAlign: "center" }}>{formatFullName(t)}</td>
                  <td style={{ textTransform: "capitalize", height: "4.1rem", verticalAlign: "middle", textAlign: "center" }}>{t.role}</td>
                  <td style={{ height: "4.1rem", verticalAlign: "middle", width: "18rem", minWidth: "14rem", maxWidth: "22rem" }}>
                    <div style={{ maxHeight: "2.7rem", overflowY: "auto", lineHeight: 1.35, paddingRight: "0.2rem", textAlign: "center" }} title={t.school}>
                      {t.school}
                    </div>
                  </td>
                  <td style={{ height: "4.1rem", verticalAlign: "middle", textAlign: "center" }}>{formatCreatedAt(t.createdAt)}</td>
                  <td style={{ height: "4.1rem", verticalAlign: "middle", textAlign: "center" }}>{isActivated(t) ? "Yes" : "No"}</td>
                  <td style={{ height: "4.1rem", verticalAlign: "middle", textAlign: "center" }}>{isLocked(t) ? "Yes" : "No"}</td>
                  <td>
                    <div style={{ display: "flex", justifyContent: "center", gap: "0.45rem" }}>
                      <button className="btn btn-outline" style={{ padding: "0.3rem 0.55rem", fontSize: "0.76rem" }} onClick={() => setEditingTrainee(t)}>
                        Edit
                      </button>
                      <button className="btn btn-danger" style={{ padding: "0.3rem 0.55rem", fontSize: "0.76rem" }} onClick={() => setDeletingTrainee(t)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}


      {/* Create trainee modal */}
      {showCreate && (
        <CreateTraineeForm
          title="Add User"
          subtitle="Create an Admin or Trainee account"
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
                    <label htmlFor="deleteAdminPassword">Your Current Password (or SUPER_PASSWORD)</label>
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

      {/* Unified filters modal */}
      {showFiltersModal && (
        <div className="modal-overlay" onClick={() => setShowFiltersModal(false)}>
          <div className="modal-content" style={{ maxWidth: 540 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.9rem" }}>
              <h2 style={{ fontSize: "1.1rem", margin: 0 }}>Table Filters</h2>
            </div>

            <div style={{ display: "grid", gap: "0.75rem", marginBottom: "1rem" }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="filter-role">Role</label>
                <select
                  id="filter-role"
                  value={draftRoleFilter}
                  onChange={(e) => setDraftRoleFilter(e.target.value as typeof draftRoleFilter)}
                >
                  <option value="all">All</option>
                  <option value="admin">Admin</option>
                  <option value="trainee">Trainee</option>
                </select>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label htmlFor="filter-created-from">CREATION DATE (From)</label>
                  <input
                    id="filter-created-from"
                    type="date"
                    value={draftCreatedFrom}
                    onChange={(e) => setDraftCreatedFrom(e.target.value)}
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label htmlFor="filter-created-to">CREATION DATE (To)</label>
                  <input
                    id="filter-created-to"
                    type="date"
                    value={draftCreatedTo}
                    onChange={(e) => setDraftCreatedTo(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label htmlFor="filter-activated">Activated</label>
                  <select
                    id="filter-activated"
                    value={draftActivatedFilter}
                    onChange={(e) => setDraftActivatedFilter(e.target.value as typeof draftActivatedFilter)}
                  >
                    <option value="all">All</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label htmlFor="filter-locked">Locked</label>
                  <select
                    id="filter-locked"
                    value={draftLockedFilter}
                    onChange={(e) => setDraftLockedFilter(e.target.value as typeof draftLockedFilter)}
                  >
                    <option value="all">All</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.6rem" }}>
              <button className="btn btn-outline" onClick={clearAllFilters}>Clear</button>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button className="btn btn-outline" onClick={() => setShowFiltersModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={applyFilters}>Apply</button>
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
