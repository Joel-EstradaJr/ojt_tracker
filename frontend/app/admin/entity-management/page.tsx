"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import RightSidebarDrawer from "@/components/RightSidebarDrawer";
import EntityTable from "@/components/EntityTable";
import { adminAddAlias, adminFetchEntities, adminMergeEntities, adminReviewEntity } from "@/lib/api";
import { CanonicalEntityAdminItem } from "@/types";

type EntityType = "school" | "company";
type DrawerMode = "alias" | "merge" | null;

export default function EntityManagementPage() {
  const [entityType, setEntityType] = useState<EntityType>("school");
  const [items, setItems] = useState<CanonicalEntityAdminItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | CanonicalEntityAdminItem["status"]>("all");
  const [drawerMode, setDrawerMode] = useState<DrawerMode>(null);
  const [aliasCanonicalId, setAliasCanonicalId] = useState("");
  const [aliasText, setAliasText] = useState("");
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [mergeSourceId, setMergeSourceId] = useState("");

  const entityLabel = entityType === "school" ? "Schools" : "Companies";
  const entitySingular = entityType === "school" ? "school" : "company";

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await adminFetchEntities(entityType);
      setItems(res.items);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load entities.");
    } finally {
      setLoading(false);
    }
  }, [entityType]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setDrawerMode(null);
    setAliasCanonicalId("");
    setAliasText("");
    setMergeTargetId("");
    setMergeSourceId("");
  }, [entityType]);

  const filteredItems = useMemo(() => {
    const tokens = searchQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);

    return items.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (tokens.length === 0) return true;

      const haystack = [
        item.name,
        item.status,
        String(item.usageCount),
        new Date(item.createdAt).toLocaleDateString("en-PH", {
          year: "numeric",
          month: "long",
          day: "numeric",
        }),
        ...(item.aliases || []).map((alias) => alias.alias),
      ]
        .join(" ")
        .toLowerCase();

      return tokens.every((token) => haystack.includes(token));
    });
  }, [items, searchQuery, statusFilter]);

  const summary = useMemo(() => ({
    total: items.length,
    pending: items.filter((item) => item.status === "PENDING").length,
    approved: items.filter((item) => item.status === "APPROVED").length,
    rejected: items.filter((item) => item.status === "REJECTED").length,
  }), [items]);

  const handleReview = async (id: string, status: CanonicalEntityAdminItem["status"]) => {
    try {
      await adminReviewEntity(entityType, id, status);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update status.");
    }
  };

  const openAliasDrawer = (item: CanonicalEntityAdminItem) => {
    setError("");
    setAliasCanonicalId(item.id);
    setAliasText("");
    setDrawerMode("alias");
  };

  const openMergeDrawer = (item: CanonicalEntityAdminItem) => {
    setError("");
    setMergeSourceId(item.id);
    setMergeTargetId("");
    setDrawerMode("merge");
  };

  const closeDrawer = () => {
    setDrawerMode(null);
    setError("");
    setAliasCanonicalId("");
    setAliasText("");
    setMergeTargetId("");
    setMergeSourceId("");
  };

  const handleAliasSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!aliasCanonicalId || !aliasText.trim()) {
      setError("Select a canonical entry and provide an alias.");
      return;
    }

    try {
      await adminAddAlias(entityType, aliasCanonicalId, aliasText.trim());
      closeDrawer();
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add alias.");
    }
  };

  const handleMergeSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!mergeSourceId || !mergeTargetId || mergeSourceId === mergeTargetId) {
      setError("Select different source and target entries.");
      return;
    }

    try {
      await adminMergeEntities(entityType, mergeSourceId, mergeTargetId);
      closeDrawer();
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to merge entities.");
    }
  };

  const selectedItemName = (id: string) => items.find((item) => item.id === id)?.name ?? "";

  return (
    <div className="container" style={{ paddingTop: "1.25rem", paddingBottom: "1.5rem" }}>
      <div className="card" style={{ marginBottom: "0.9rem" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <h2 style={{ marginBottom: "0.35rem" }}>Entity Management</h2>
            <p style={{ color: "var(--text-muted)" }}>
              Review canonical schools and companies, approve pending names, and manage aliases or merges from the sidebar.
            </p>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button className={`btn ${entityType === "school" ? "btn-primary" : "btn-outline"}`} type="button" onClick={() => setEntityType("school")}>Schools</button>
            <button className={`btn ${entityType === "company" ? "btn-primary" : "btn-outline"}`} type="button" onClick={() => setEntityType("company")}>Companies</button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "0.75rem", marginTop: "1rem" }}>
          <div style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "0.75rem" }}>
            <div style={{ fontSize: "0.72rem", textTransform: "uppercase", color: "var(--text-muted)" }}>Total</div>
            <div style={{ fontSize: "1.35rem", fontWeight: 700 }}>{summary.total}</div>
          </div>
          <div style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "0.75rem" }}>
            <div style={{ fontSize: "0.72rem", textTransform: "uppercase", color: "var(--text-muted)" }}>Pending</div>
            <div style={{ fontSize: "1.35rem", fontWeight: 700 }}>{summary.pending}</div>
          </div>
          <div style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "0.75rem" }}>
            <div style={{ fontSize: "0.72rem", textTransform: "uppercase", color: "var(--text-muted)" }}>Approved</div>
            <div style={{ fontSize: "1.35rem", fontWeight: 700 }}>{summary.approved}</div>
          </div>
          <div style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "0.75rem" }}>
            <div style={{ fontSize: "0.72rem", textTransform: "uppercase", color: "var(--text-muted)" }}>Rejected</div>
            <div style={{ fontSize: "1.35rem", fontWeight: 700 }}>{summary.rejected}</div>
          </div>
        </div>

        {error && <div style={{ color: "var(--danger)", marginTop: "0.85rem", fontSize: "0.85rem" }}>{error}</div>}
      </div>

      <div className="card" style={{ marginBottom: "0.9rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(220px, 0.7fr)", gap: "0.75rem", alignItems: "end" }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Search</label>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search ${entityLabel.toLowerCase()} by name, alias, or status`}
            />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label>Status Filter</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
              <option value="all">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </div>
        </div>
      </div>

      <EntityTable
        items={filteredItems}
        loading={loading}
        entityLabel={entityLabel}
        onReview={handleReview}
        onOpenMerge={openMergeDrawer}
        onOpenAlias={openAliasDrawer}
      />

      {drawerMode && (
        <RightSidebarDrawer onClose={closeDrawer} width={620}>
          <div className="card drawer-form-card" style={{ margin: 0, border: "none", boxShadow: "none", background: "transparent" }}>
            <div className="drawer-form-header" style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
              <div style={{ width: "2.5rem", height: "2.5rem", borderRadius: "var(--radius-sm)", background: "var(--primary-light)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l4 7 7 1-5 5 1 7-7-4-7 4 1-7-5-5 7-1z" /></svg>
              </div>
              <div>
                <h2 style={{ fontSize: "1.15rem", marginBottom: "0.1rem" }}>{drawerMode === "alias" ? "Add Alias" : "Merge Entries"}</h2>
                <p style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
                  {drawerMode === "alias"
                    ? `Create an alias for a ${entitySingular}.`
                    : `Merge one ${entitySingular} into another canonical entry.`}
                </p>
              </div>
            </div>

            {drawerMode === "alias" ? (
              <form className="drawer-form" onSubmit={handleAliasSave}>
                <div className="drawer-form-body">
                  <div className="form-group">
                    <label>Select Canonical Entry</label>
                    <select value={aliasCanonicalId} onChange={(event) => setAliasCanonicalId(event.target.value)}>
                      <option value="">Choose an entry</option>
                      {items.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} ({item.status})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Alias Text</label>
                    <input
                      value={aliasText}
                      onChange={(event) => setAliasText(event.target.value)}
                      placeholder="Type the alternate name"
                    />
                  </div>
                </div>
                <div className="drawer-form-footer">
                  <button type="button" className="btn btn-outline" onClick={closeDrawer}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Save Alias</button>
                </div>
              </form>
            ) : (
              <form className="drawer-form" onSubmit={handleMergeSave}>
                <div className="drawer-form-body">
                  <div className="form-group">
                    <label>Select Canonical Entry (Target)</label>
                    <select value={mergeTargetId} onChange={(event) => setMergeTargetId(event.target.value)}>
                      <option value="">Choose target entry</option>
                      {items.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} ({item.status})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Select Source Entry</label>
                    <select value={mergeSourceId} onChange={(event) => setMergeSourceId(event.target.value)}>
                      <option value="">Choose source entry</option>
                      {items.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} ({item.status})
                        </option>
                      ))}
                    </select>
                  </div>
                  {mergeSourceId && mergeTargetId && mergeSourceId === mergeTargetId && (
                    <div style={{ color: "var(--danger)", fontSize: "0.84rem" }}>Source and target must be different entries.</div>
                  )}
                  {mergeSourceId && mergeTargetId && (
                    <div style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
                      {selectedItemName(mergeSourceId)} will be merged into {selectedItemName(mergeTargetId)}.
                    </div>
                  )}
                </div>
                <div className="drawer-form-footer">
                  <button type="button" className="btn btn-outline" onClick={closeDrawer}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Merge</button>
                </div>
              </form>
            )}
          </div>
        </RightSidebarDrawer>
      )}
    </div>
  );
}
