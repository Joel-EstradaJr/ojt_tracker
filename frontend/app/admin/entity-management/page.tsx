"use client";

import { useEffect, useMemo, useState } from "react";
import {
  adminAddAlias,
  adminFetchEntities,
  adminMergeEntities,
  adminReviewEntity,
} from "@/lib/api";
import { CanonicalEntityAdminItem } from "@/types";

type EntityType = "school" | "company";

export default function EntityManagementPage() {
  const [type, setType] = useState<EntityType>("school");
  const [items, setItems] = useState<CanonicalEntityAdminItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mergeSource, setMergeSource] = useState("");
  const [mergeTarget, setMergeTarget] = useState("");
  const [aliasText, setAliasText] = useState("");
  const [selectedCanonical, setSelectedCanonical] = useState("");

  const pendingCount = useMemo(() => items.filter((item) => item.status === "PENDING").length, [items]);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await adminFetchEntities(type);
      setItems(res.items);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load entities.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [type]);

  const handleReview = async (id: string, status: "PENDING" | "APPROVED" | "REJECTED") => {
    try {
      await adminReviewEntity(type, id, status);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update status.");
    }
  };

  const handleMerge = async () => {
    if (!mergeSource || !mergeTarget) {
      setError("Select both source and target canonical entries.");
      return;
    }

    try {
      await adminMergeEntities(type, mergeSource, mergeTarget);
      setMergeSource("");
      setMergeTarget("");
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to merge entities.");
    }
  };

  const handleAddAlias = async () => {
    if (!selectedCanonical || !aliasText.trim()) {
      setError("Select a canonical entry and provide an alias.");
      return;
    }

    try {
      await adminAddAlias(type, selectedCanonical, aliasText.trim());
      setAliasText("");
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add alias.");
    }
  };

  return (
    <div className="container" style={{ paddingTop: "1.25rem", paddingBottom: "1.5rem" }}>
      <div className="card" style={{ marginBottom: "0.9rem" }}>
        <h2 style={{ marginBottom: "0.35rem" }}>Canonical Entity Management</h2>
        <p style={{ color: "var(--text-muted)", marginBottom: "0.8rem" }}>
          Review pending names, add aliases, and merge duplicate entities so all trainee records point to a single canonical entry.
        </p>

        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.6rem" }}>
          <button className={`btn ${type === "school" ? "btn-primary" : "btn-outline"}`} type="button" onClick={() => setType("school")}>Schools</button>
          <button className={`btn ${type === "company" ? "btn-primary" : "btn-outline"}`} type="button" onClick={() => setType("company")}>Companies</button>
          <span style={{ marginLeft: "auto", fontSize: "0.85rem", color: "var(--text-muted)", alignSelf: "center" }}>
            Pending: {pendingCount}
          </span>
        </div>

        {error && <div style={{ color: "var(--danger)", marginBottom: "0.6rem", fontSize: "0.85rem" }}>{error}</div>}
      </div>

      <div className="card" style={{ marginBottom: "0.9rem" }}>
        <h3 style={{ marginBottom: "0.5rem" }}>Merge Duplicates</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "0.45rem" }}>
          <select value={mergeSource} onChange={(e) => setMergeSource(e.target.value)}>
            <option value="">Select source (duplicate)</option>
            {items.map((item) => <option key={`source-${item.id}`} value={item.id}>{item.name}</option>)}
          </select>
          <select value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}>
            <option value="">Select target (canonical)</option>
            {items.map((item) => <option key={`target-${item.id}`} value={item.id}>{item.name}</option>)}
          </select>
          <button className="btn btn-primary" type="button" onClick={handleMerge}>Merge</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "0.9rem" }}>
        <h3 style={{ marginBottom: "0.5rem" }}>Add Alias</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "0.45rem" }}>
          <select value={selectedCanonical} onChange={(e) => setSelectedCanonical(e.target.value)}>
            <option value="">Select canonical entry</option>
            {items.map((item) => <option key={`alias-${item.id}`} value={item.id}>{item.name}</option>)}
          </select>
          <input value={aliasText} onChange={(e) => setAliasText(e.target.value)} placeholder="Alias text (e.g. PUP)" />
          <button className="btn btn-outline" type="button" onClick={handleAddAlias}>Save Alias</button>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: "0.65rem" }}>Entries</h3>
        {loading ? (
          <p style={{ color: "var(--text-muted)" }}>Loading...</p>
        ) : (
          <div style={{ display: "grid", gap: "0.55rem" }}>
            {items.map((item) => (
              <div key={item.id} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "0.7rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.35rem" }}>
                  <strong>{item.name}</strong>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>status: {item.status}</span>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>usage: {item.usageCount}</span>
                  <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>linked trainees: {item.traineeCount}</span>
                  <div style={{ marginLeft: "auto", display: "flex", gap: "0.35rem" }}>
                    <button className="btn btn-outline" style={{ padding: "0.25rem 0.45rem", fontSize: "0.75rem" }} type="button" onClick={() => handleReview(item.id, "APPROVED")}>Approve</button>
                    <button className="btn btn-outline" style={{ padding: "0.25rem 0.45rem", fontSize: "0.75rem" }} type="button" onClick={() => handleReview(item.id, "REJECTED")}>Reject</button>
                    <button className="btn btn-outline" style={{ padding: "0.25rem 0.45rem", fontSize: "0.75rem" }} type="button" onClick={() => handleReview(item.id, "PENDING")}>Pending</button>
                  </div>
                </div>
                <div style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
                  Aliases: {item.aliases.length > 0 ? item.aliases.map((alias) => alias.alias).join(", ") : "(none)"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
