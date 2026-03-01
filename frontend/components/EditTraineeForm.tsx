"use client";

// ============================================================
// EditTraineeForm — modal form to edit an existing trainee's
// info and manage their supervisors (add, edit, delete).
// ============================================================

import { useState, useEffect, useCallback } from "react";
import { updateTrainee, fetchSupervisors, createSupervisor, updateSupervisor, deleteSupervisor } from "@/lib/api";
import { Trainee, Supervisor, SupervisorInput } from "@/types";

interface Props {
  trainee: Trainee;
  onClose: () => void;
  onUpdated: () => void;
}

const SUFFIX_OPTIONS = ["", "Jr.", "Sr.", "II", "III", "IV", "V", "VI", "VII", "VIII"] as const;

const emptySupervisor = (): SupervisorInput => ({
  lastName: "",
  firstName: "",
  middleName: "",
  suffix: "",
  contactNumber: "",
  email: "",
});

export default function EditTraineeForm({ trainee, onClose, onUpdated }: Props) {
  // ── Trainee fields ──────────────────────────────────────────
  const [lastName, setLastName] = useState(trainee.lastName);
  const [firstName, setFirstName] = useState(trainee.firstName);
  const [middleName, setMiddleName] = useState(trainee.middleName ?? "");
  const [suffix, setSuffix] = useState(trainee.suffix ?? "");
  const [email, setEmail] = useState(trainee.email);
  const [contactNumber, setContactNumber] = useState(trainee.contactNumber);
  const [school, setSchool] = useState(trainee.school);
  const [companyName, setCompanyName] = useState(trainee.companyName);
  const [requiredHours, setRequiredHours] = useState(String(trainee.requiredHours));

  // ── Existing supervisors (from DB) ──────────────────────────
  const [existingSupervisors, setExistingSupervisors] = useState<Supervisor[]>([]);
  // Edited copies keyed by id
  const [editedSupervisors, setEditedSupervisors] = useState<Record<string, SupervisorInput>>({});
  // IDs marked for deletion
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());

  // ── New supervisors to add ──────────────────────────────────
  const [newSupervisors, setNewSupervisors] = useState<SupervisorInput[]>([]);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Load existing supervisors
  const loadSupervisors = useCallback(async () => {
    try {
      const sups = await fetchSupervisors(trainee.id);
      setExistingSupervisors(sups);
      // Seed editable copies
      const map: Record<string, SupervisorInput> = {};
      for (const s of sups) {
        map[s.id] = {
          lastName: s.lastName,
          firstName: s.firstName,
          middleName: s.middleName ?? "",
          suffix: s.suffix ?? "",
          contactNumber: s.contactNumber ?? "",
          email: s.email ?? "",
        };
      }
      setEditedSupervisors(map);
    } catch (err) {
      console.error("Failed to load supervisors:", err);
    }
  }, [trainee.id]);

  useEffect(() => {
    loadSupervisors();
  }, [loadSupervisors]);

  // ── Helpers for existing supervisors ────────────────────────
  const updateExistingField = (id: string, field: keyof SupervisorInput, value: string) => {
    setEditedSupervisors((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
  };

  const toggleDeleteExisting = (id: string) => {
    setDeletedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── Helpers for new supervisors ─────────────────────────────
  const addNewSupervisor = () => setNewSupervisors([...newSupervisors, emptySupervisor()]);

  const removeNewSupervisor = (idx: number) =>
    setNewSupervisors(newSupervisors.filter((_, i) => i !== idx));

  const updateNewField = (idx: number, field: keyof SupervisorInput, value: string) => {
    const updated = [...newSupervisors];
    updated[idx] = { ...updated[idx], [field]: value };
    setNewSupervisors(updated);
  };

  // ── Submit ──────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!lastName || !firstName || !email || !contactNumber || !school || !companyName || !requiredHours) {
      setError("All required fields must be filled.");
      return;
    }

    // Validate edited existing supervisors (not deleted)
    for (const sup of existingSupervisors) {
      if (deletedIds.has(sup.id)) continue;
      const s = editedSupervisors[sup.id];
      if (!s.lastName || !s.firstName) {
        setError(`Supervisor "${sup.displayName}": Last Name and First Name are required.`);
        return;
      }
      if (!s.contactNumber?.trim() && !s.email?.trim()) {
        setError(`Supervisor "${sup.displayName}": At least one of Contact Number or Email is required.`);
        return;
      }
    }

    // Validate new supervisors
    for (let i = 0; i < newSupervisors.length; i++) {
      const s = newSupervisors[i];
      if (!s.lastName || !s.firstName) {
        setError(`New Supervisor #${i + 1}: Last Name and First Name are required.`);
        return;
      }
      if (!s.contactNumber?.trim() && !s.email?.trim()) {
        setError(`New Supervisor #${i + 1}: At least one of Contact Number or Email is required.`);
        return;
      }
    }

    setLoading(true);
    try {
      // 1. Update trainee info
      await updateTrainee(trainee.id, {
        lastName,
        firstName,
        middleName: middleName || undefined,
        suffix: suffix || undefined,
        email,
        contactNumber,
        school,
        companyName,
        requiredHours: Number(requiredHours),
      });

      // 2. Delete removed supervisors
      for (const id of deletedIds) {
        await deleteSupervisor(id);
      }

      // 3. Update existing supervisors
      for (const sup of existingSupervisors) {
        if (deletedIds.has(sup.id)) continue;
        await updateSupervisor(sup.id, editedSupervisors[sup.id]);
      }

      // 4. Create new supervisors
      for (const s of newSupervisors) {
        await createSupervisor(trainee.id, s);
      }

      onUpdated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update trainee.");
    } finally {
      setLoading(false);
    }
  };

  // ── Render a supervisor form block ──────────────────────────
  const renderSupervisorFields = (
    s: SupervisorInput,
    onChange: (field: keyof SupervisorInput, value: string) => void,
    onRemove: () => void,
    isDeleted?: boolean,
    label?: string
  ) => (
    <div
      style={{
        background: "var(--bg)",
        padding: "0.75rem",
        borderRadius: "6px",
        marginBottom: "0.5rem",
        position: "relative",
        opacity: isDeleted ? 0.45 : 1,
        pointerEvents: isDeleted ? "none" : "auto",
      }}
    >
      {label && (
        <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: 600 }}>{label}</span>
      )}
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); onRemove(); }}
        style={{
          position: "absolute",
          top: "0.4rem",
          right: "0.5rem",
          background: "none",
          border: "none",
          color: isDeleted ? "var(--primary)" : "var(--danger)",
          fontWeight: 700,
          fontSize: isDeleted ? "0.75rem" : "1rem",
          cursor: "pointer",
        }}
      >
        {isDeleted ? "Undo" : "×"}
      </button>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem" }}>
        <div className="form-group" style={{ marginBottom: "0.4rem" }}>
          <label>Last Name *</label>
          <input value={s.lastName} onChange={(e) => onChange("lastName", e.target.value)} />
        </div>
        <div className="form-group" style={{ marginBottom: "0.4rem" }}>
          <label>First Name *</label>
          <input value={s.firstName} onChange={(e) => onChange("firstName", e.target.value)} />
        </div>
        <div className="form-group" style={{ marginBottom: "0.4rem" }}>
          <label>Middle Name</label>
          <input value={s.middleName ?? ""} onChange={(e) => onChange("middleName", e.target.value)} />
        </div>
        <div className="form-group" style={{ marginBottom: "0.4rem" }}>
          <label>Suffix</label>
          <select value={s.suffix ?? ""} onChange={(e) => onChange("suffix", e.target.value)}>
            {SUFFIX_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt || "— None —"}</option>
            ))}
          </select>
        </div>
        <div className="form-group" style={{ marginBottom: "0.4rem" }}>
          <label>Contact Number</label>
          <input value={s.contactNumber ?? ""} onChange={(e) => onChange("contactNumber", e.target.value)} />
        </div>
        <div className="form-group" style={{ marginBottom: "0.4rem" }}>
          <label>Email</label>
          <input type="email" value={s.email ?? ""} onChange={(e) => onChange("email", e.target.value)} />
        </div>
      </div>
    </div>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 560, maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: "1rem" }}>Edit Trainee</h2>

        <form onSubmit={handleSubmit}>
          {/* ── Name fields ──────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
            <div className="form-group">
              <label>Last Name *</label>
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
            <div className="form-group">
              <label>First Name *</label>
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Middle Name</label>
              <input value={middleName} onChange={(e) => setMiddleName(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Suffix</label>
              <select value={suffix} onChange={(e) => setSuffix(e.target.value)}>
                {SUFFIX_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt || "— None —"}</option>
                ))}
              </select>
            </div>
          </div>

          {/* ── Contact fields ───────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
            <div className="form-group">
              <label>Email *</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Contact Number *</label>
              <input value={contactNumber} onChange={(e) => setContactNumber(e.target.value)} />
            </div>
          </div>

          {/* ── School, Company, Hours ────────────────── */}
          <div className="form-group">
            <label>School *</label>
            <input value={school} onChange={(e) => setSchool(e.target.value)} />
          </div>

          <div className="form-group">
            <label>Company / Institution Name *</label>
            <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </div>

          <div className="form-group">
            <label>Required Hours *</label>
            <input type="number" min="1" value={requiredHours} onChange={(e) => setRequiredHours(e.target.value)} />
          </div>

          {/* ── Supervisors section ──────────────────── */}
          <div style={{ marginTop: "1rem", borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
              <label style={{ fontWeight: 600, fontSize: "0.85rem" }}>SUPERVISORS</label>
              <button
                type="button"
                className="btn btn-outline"
                style={{ fontSize: "0.8rem", padding: "0.3rem 0.7rem" }}
                onClick={addNewSupervisor}
              >
                + Add Supervisor
              </button>
            </div>

            {/* Existing supervisors */}
            {existingSupervisors.map((sup) =>
              renderSupervisorFields(
                editedSupervisors[sup.id] ?? emptySupervisor(),
                (field, value) => updateExistingField(sup.id, field, value),
                () => toggleDeleteExisting(sup.id),
                deletedIds.has(sup.id),
              )
            )}

            {/* New supervisors */}
            {newSupervisors.map((s, idx) =>
              renderSupervisorFields(
                s,
                (field, value) => updateNewField(idx, field, value),
                () => removeNewSupervisor(idx),
                false,
                `New Supervisor #${idx + 1}`,
              )
            )}

            {existingSupervisors.length === 0 && newSupervisors.length === 0 && (
              <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>No supervisors assigned.</p>
            )}
          </div>

          {/* ── Error & actions ──────────────────────── */}
          {error && (
            <p style={{ color: "var(--danger)", marginBottom: "0.75rem", marginTop: "0.5rem", fontSize: "0.85rem" }}>{error}</p>
          )}

          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1rem" }}>
            <button type="button" className="btn btn-outline" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
