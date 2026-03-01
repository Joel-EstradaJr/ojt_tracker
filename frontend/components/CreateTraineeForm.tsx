"use client";

// ============================================================
// CreateTraineeForm — modal form to add a new OJT trainee
// with structured name, contact, company, and supervisors.
// ============================================================

import { useState } from "react";
import { createTrainee } from "@/lib/api";
import { SupervisorInput } from "@/types";
import { sanitizeInput, validateName, validateInstitution, isValidEmail, isValidPhone, phoneCharsOnly } from "@/lib/sanitize";

interface Props {
  onClose: () => void;
  onCreated: () => void;
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

export default function CreateTraineeForm({ onClose, onCreated }: Props) {
  // Trainee fields
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [suffix, setSuffix] = useState("");
  const [email, setEmail] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [school, setSchool] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [requiredHours, setRequiredHours] = useState("500");
  const [password, setPassword] = useState("");

  // Supervisors (dynamic list)
  const [supervisors, setSupervisors] = useState<SupervisorInput[]>([]);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // ── Supervisor helpers ──────────────────────────────────────
  const addSupervisor = () => setSupervisors([...supervisors, emptySupervisor()]);

  const removeSupervisor = (idx: number) =>
    setSupervisors(supervisors.filter((_, i) => i !== idx));

  const updateSupervisor = (idx: number, field: keyof SupervisorInput, value: string) => {
    const updated = [...supervisors];
    updated[idx] = { ...updated[idx], [field]: value };
    setSupervisors(updated);
  };

  // ── Submit ──────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // Client-side required-field check
    if (!lastName || !firstName || !email || !contactNumber || !school || !companyName || !requiredHours || !password) {
      setError("All required fields must be filled.");
      return;
    }

    // Content-quality checks
    const lnErr = validateName("Last name", lastName, true);    if (lnErr) { setError(lnErr); return; }
    const fnErr = validateName("First name", firstName, true);   if (fnErr) { setError(fnErr); return; }
    const mnErr = validateName("Middle name", middleName, false); if (mnErr) { setError(mnErr); return; }
    if (!isValidEmail(email)) { setError("Please enter a valid email address (e.g. name@example.com)."); return; }
    if (!phoneCharsOnly(contactNumber)) { setError("Contact number must contain only digits, +, -, (, ), and spaces."); return; }
    if (!isValidPhone(contactNumber)) { setError("Contact number must have at least 7 digits."); return; }
    const schErr = validateInstitution("School", school);       if (schErr) { setError(schErr); return; }
    const coErr = validateInstitution("Company name", companyName); if (coErr) { setError(coErr); return; }

    // Validate each supervisor has at least email or contactNumber
    for (let i = 0; i < supervisors.length; i++) {
      const s = supervisors[i];
      const sLn = validateName(`Supervisor #${i + 1} last name`, s.lastName, true);  if (sLn) { setError(sLn); return; }
      const sFn = validateName(`Supervisor #${i + 1} first name`, s.firstName, true); if (sFn) { setError(sFn); return; }
      const sMn = validateName(`Supervisor #${i + 1} middle name`, s.middleName ?? "", false); if (sMn) { setError(sMn); return; }
      if (!s.contactNumber?.trim() && !s.email?.trim()) {
        setError(`Supervisor #${i + 1}: At least one of Contact Number or Email is required.`);
        return;
      }
    }

    setLoading(true);
    try {
      await createTrainee({
        lastName,
        firstName,
        middleName: middleName || undefined,
        suffix: suffix || undefined,
        email,
        contactNumber,
        school,
        companyName,
        requiredHours: Number(requiredHours),
        password,
        supervisors: supervisors.length > 0 ? supervisors : undefined,
      });
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create trainee.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 560, maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: "1rem" }}>Add New Trainee</h2>

        <form onSubmit={handleSubmit}>
          {/* ── Name fields ──────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
            <div className="form-group">
              <label>Last Name *</label>
              <input value={lastName} onChange={(e) => setLastName(sanitizeInput(e.target.value))} placeholder="Dela Cruz" />
            </div>
            <div className="form-group">
              <label>First Name *</label>
              <input value={firstName} onChange={(e) => setFirstName(sanitizeInput(e.target.value))} placeholder="Juan" />
            </div>
            <div className="form-group">
              <label>Middle Name</label>
              <input value={middleName} onChange={(e) => setMiddleName(sanitizeInput(e.target.value))} placeholder="Santos" />
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
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="juan@email.com" />
            </div>
            <div className="form-group">
              <label>Contact Number *</label>
              <input value={contactNumber} onChange={(e) => setContactNumber(sanitizeInput(e.target.value))} placeholder="09171234567" />
            </div>
          </div>

          {/* ── School, Company, Hours ────────────────── */}
          <div className="form-group">
            <label>School *</label>
            <input value={school} onChange={(e) => setSchool(sanitizeInput(e.target.value))} placeholder="University of…" />
          </div>

          <div className="form-group">
            <label>Company / Institution Name *</label>
            <input value={companyName} onChange={(e) => setCompanyName(sanitizeInput(e.target.value))} placeholder="Company where OJT is rendered" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
            <div className="form-group">
              <label>Required Hours *</label>
              <input type="number" min="1" value={requiredHours} onChange={(e) => setRequiredHours(e.target.value)} />
            </div>
            <div className="form-group">
              <label>Password *</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Set a unique password" />
            </div>
          </div>

          {/* ── Supervisors section ──────────────────── */}
          <div style={{ marginTop: "1rem", borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
              <label style={{ fontWeight: 600, fontSize: "0.85rem" }}>SUPERVISORS</label>
              <button type="button" className="btn btn-outline" style={{ fontSize: "0.8rem", padding: "0.3rem 0.7rem" }} onClick={addSupervisor}>
                + Add Supervisor
              </button>
            </div>

            {supervisors.map((s, idx) => (
              <div key={idx} style={{ background: "var(--bg)", padding: "0.75rem", borderRadius: "6px", marginBottom: "0.5rem", position: "relative" }}>
                <button
                  type="button"
                  onClick={() => removeSupervisor(idx)}
                  style={{ position: "absolute", top: "0.4rem", right: "0.5rem", background: "none", border: "none", color: "var(--danger)", fontWeight: 700, fontSize: "1rem", cursor: "pointer" }}
                >
                  ×
                </button>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem" }}>
                  <div className="form-group" style={{ marginBottom: "0.4rem" }}>
                    <label>Last Name *</label>
                    <input value={s.lastName} onChange={(e) => updateSupervisor(idx, "lastName", sanitizeInput(e.target.value))} />
                  </div>
                  <div className="form-group" style={{ marginBottom: "0.4rem" }}>
                    <label>First Name *</label>
                    <input value={s.firstName} onChange={(e) => updateSupervisor(idx, "firstName", sanitizeInput(e.target.value))} />
                  </div>
                  <div className="form-group" style={{ marginBottom: "0.4rem" }}>
                    <label>Middle Name</label>
                    <input value={s.middleName ?? ""} onChange={(e) => updateSupervisor(idx, "middleName", sanitizeInput(e.target.value))} />
                  </div>
                  <div className="form-group" style={{ marginBottom: "0.4rem" }}>
                    <label>Suffix</label>
                    <select value={s.suffix ?? ""} onChange={(e) => updateSupervisor(idx, "suffix", e.target.value)}>
                      {SUFFIX_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>{opt || "— None —"}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group" style={{ marginBottom: "0.4rem" }}>
                    <label>Contact Number</label>
                    <input value={s.contactNumber ?? ""} onChange={(e) => updateSupervisor(idx, "contactNumber", sanitizeInput(e.target.value))} />
                  </div>
                  <div className="form-group" style={{ marginBottom: "0.4rem" }}>
                    <label>Email</label>
                    <input type="email" value={s.email ?? ""} onChange={(e) => updateSupervisor(idx, "email", e.target.value)} />
                  </div>
                </div>
              </div>
            ))}
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
              {loading ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
