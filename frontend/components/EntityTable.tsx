"use client";

import { useEffect, useMemo, useState } from "react";
import { CanonicalEntityAdminItem } from "@/types";

type SortField = "name" | "status" | "usageCount" | "createdAt" | null;
type SortDir = "asc" | "desc" | null;

type Props = {
  items: CanonicalEntityAdminItem[];
  loading: boolean;
  entityLabel: string;
  onReview: (id: string, status: CanonicalEntityAdminItem["status"]) => void;
  onOpenMerge: (item: CanonicalEntityAdminItem) => void;
  onOpenAlias: (item: CanonicalEntityAdminItem) => void;
};

const STATUS_ORDER: Record<CanonicalEntityAdminItem["status"], number> = {
  PENDING: 0,
  APPROVED: 1,
  REJECTED: 2,
};

function formatUpperDate(value: string) {
  return new Date(value)
    .toLocaleDateString("en-PH", {
      year: "numeric",
      month: "long",
      day: "numeric",
    })
    .toUpperCase();
}

function statusTone(status: CanonicalEntityAdminItem["status"]) {
  if (status === "APPROVED") {
    return { background: "var(--success-light)", color: "var(--success-text)" };
  }
  if (status === "PENDING") {
    return { background: "var(--warning-light)", color: "var(--warning-text)" };
  }
  return { background: "var(--danger-light)", color: "var(--danger)" };
}

function statusActions(item: CanonicalEntityAdminItem) {
  const actions: Array<{ label: string; status: CanonicalEntityAdminItem["status"] }> = [];

  if (item.status === "PENDING") {
    actions.push({ label: "Approve", status: "APPROVED" });
    actions.push({ label: "Reject", status: "REJECTED" });
  } else if (item.status === "APPROVED") {
    actions.push({ label: "Pending", status: "PENDING" });
    actions.push({ label: "Reject", status: "REJECTED" });
  } else {
    actions.push({ label: "Approve", status: "APPROVED" });
    actions.push({ label: "Pending", status: "PENDING" });
  }

  return actions;
}

export default function EntityTable({
  items,
  loading,
  entityLabel,
  onReview,
  onOpenMerge,
  onOpenAlias,
}: Props) {
  const [sortField, setSortField] = useState<SortField>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    setCurrentPage(1);
  }, [rowsPerPage, items.length]);

  const sortedItems = useMemo(() => {
    if (!sortField || !sortDir) return items;

    const direction = sortDir === "asc" ? 1 : -1;
    return [...items].sort((a, b) => {
      if (sortField === "name") return a.name.localeCompare(b.name) * direction;
      if (sortField === "status") return (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) * direction;
      if (sortField === "usageCount") return (a.usageCount - b.usageCount) * direction;
      return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * direction;
    });
  }, [items, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedItems.length / rowsPerPage));
  const safePage = Math.min(currentPage, totalPages);

  const pagedItems = useMemo(() => {
    const start = (safePage - 1) * rowsPerPage;
    return sortedItems.slice(start, start + rowsPerPage);
  }, [rowsPerPage, safePage, sortedItems]);

  const pageNumbers = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);

    const start = Math.max(1, safePage - 2);
    const end = Math.min(totalPages, start + 4);
    const adjustedStart = Math.max(1, end - 4);

    return Array.from({ length: end - adjustedStart + 1 }, (_, i) => adjustedStart + i);
  }, [safePage, totalPages]);

  const toggleSort = (field: Exclude<SortField, null>) => {
    if (sortField !== field) {
      setSortField(field);
      setSortDir("asc");
      return;
    }

    if (sortDir === "asc") {
      setSortDir("desc");
      return;
    }

    if (sortDir === "desc") {
      setSortField(null);
      setSortDir(null);
      return;
    }

    setSortDir("asc");
  };

  const sortIndicator = (field: Exclude<SortField, null>) => {
    if (sortField !== field || !sortDir) return "↕";
    return sortDir === "asc" ? "↑" : "↓";
  };

  const headerButton = (field: Exclude<SortField, null>, label: string) => (
    <button
      type="button"
      onClick={() => toggleSort(field)}
      className="btn btn-ghost"
      style={{
        padding: 0,
        fontSize: "0.78rem",
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.02em",
        color: sortField === field ? "var(--primary)" : "var(--text-secondary)",
      }}
    >
      {label} <span style={{ opacity: 0.7 }}>{sortIndicator(field)}</span>
    </button>
  );

  return (
    <div className="card" style={{ marginBottom: "0.9rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", marginBottom: "0.7rem" }}>
        <h3 style={{ marginBottom: 0 }}>{entityLabel} Table</h3>

        <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap", marginLeft: "auto" }}>
          <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Rows</span>
          <select
            value={rowsPerPage}
            onChange={(event) => {
              setRowsPerPage(Number(event.target.value));
              setCurrentPage(1);
            }}
            style={{ width: "4.7rem", padding: "0.35rem 0.45rem", fontSize: "0.8rem" }}
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>

          <button
            className="btn btn-outline"
            style={{ fontSize: "0.78rem", padding: "0.35rem 0.6rem" }}
            type="button"
            disabled={safePage <= 1}
            onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
          >
            Prev
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: "0.2rem" }}>
            {pageNumbers.map((page) => (
              <button
                key={page}
                type="button"
                className={page === safePage ? "btn btn-primary" : "btn btn-outline"}
                style={{ minWidth: "2rem", height: "2rem", padding: "0.25rem", fontSize: "0.78rem" }}
                onClick={() => setCurrentPage(page)}
              >
                {page}
              </button>
            ))}
          </div>

          <button
            className="btn btn-outline"
            style={{ fontSize: "0.78rem", padding: "0.35rem 0.6rem" }}
            type="button"
            disabled={safePage >= totalPages}
            onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
          >
            Next
          </button>
        </div>
      </div>

      {loading ? (
        <p style={{ color: "var(--text-muted)" }}>Loading...</p>
      ) : (
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
          <div style={{ maxHeight: "34rem", overflowY: "auto", overflowX: "auto" }}>
            <table className="logs-table" style={{ width: "100%", tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "22%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "16%" }} />
                <col style={{ width: "24%" }} />
                <col style={{ width: "16%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", position: "sticky", top: 0, background: "var(--surface)", zIndex: 1 }}>{headerButton("name", "Name")}</th>
                  <th style={{ textAlign: "center", position: "sticky", top: 0, background: "var(--surface)", zIndex: 1 }}>{headerButton("status", "Status")}</th>
                  <th style={{ textAlign: "center", position: "sticky", top: 0, background: "var(--surface)", zIndex: 1 }}>{headerButton("usageCount", "Usage")}</th>
                  <th style={{ textAlign: "center", position: "sticky", top: 0, background: "var(--surface)", zIndex: 1 }}>{headerButton("createdAt", "Created")}</th>
                  <th style={{ textAlign: "left", position: "sticky", top: 0, background: "var(--surface)", zIndex: 1 }}>Aliases</th>
                  <th style={{ textAlign: "center", position: "sticky", top: 0, background: "var(--surface)", zIndex: 1 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedItems.map((item) => (
                  <tr key={item.id} style={{ height: "3.5rem" }}>
                    <td style={{ verticalAlign: "middle" }}>
                      <div title={item.name} style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {item.name}
                      </div>
                    </td>
                    <td style={{ textAlign: "center", verticalAlign: "middle" }}>
                      <span style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: "6.4rem",
                        height: "1.75rem",
                        borderRadius: 999,
                        fontSize: "0.72rem",
                        fontWeight: 700,
                        ...statusTone(item.status),
                      }}>
                        {item.status}
                      </span>
                    </td>
                    <td style={{ textAlign: "center", verticalAlign: "middle" }}>{item.usageCount}</td>
                    <td style={{ textAlign: "center", verticalAlign: "middle" }}>{formatUpperDate(item.createdAt)}</td>
                    <td style={{ verticalAlign: "middle" }}>
                      <div
                        title={item.aliases.length > 0 ? item.aliases.map((alias) => alias.alias).join(", ") : "(none)"}
                        style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--text-secondary)" }}
                      >
                        {item.aliases.length > 0 ? item.aliases.map((alias) => alias.alias).join(", ") : "(none)"}
                      </div>
                    </td>
                    <td style={{ verticalAlign: "middle" }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.3rem" }}>
                        {statusActions(item).map((action) => (
                          <button
                            key={`${item.id}-${action.status}`}
                            className="btn btn-outline"
                            style={{ width: "6.4rem", height: "2rem", padding: "0.25rem 0.5rem", fontSize: "0.76rem" }}
                            type="button"
                            onClick={() => onReview(item.id, action.status)}
                          >
                            {action.label}
                          </button>
                        ))}
                        <button
                          className="btn btn-outline"
                          style={{ width: "6.4rem", height: "2rem", padding: "0.25rem 0.5rem", fontSize: "0.76rem" }}
                          type="button"
                          onClick={() => onOpenMerge(item)}
                        >
                          Merge
                        </button>
                        <button
                          className="btn btn-outline"
                          style={{ width: "6.4rem", height: "2rem", padding: "0.25rem 0.5rem", fontSize: "0.76rem" }}
                          type="button"
                          onClick={() => onOpenAlias(item)}
                        >
                          Alias
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                {pagedItems.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", padding: "2rem 1rem", color: "var(--text-muted)" }}>
                      No entities match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
