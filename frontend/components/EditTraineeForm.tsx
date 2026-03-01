"use client";

// ============================================================
// EditTraineeForm — modal form to edit an existing trainee's
// info and manage their supervisors (add, edit, delete).
// ============================================================

import { useState, useEffect, useCallback } from "react";
import { updateTrainee, fetchSupervisors, createSupervisor, updateSupervisor, deleteSupervisor, sendEmailVerification, verifyEmailCode } from "@/lib/api";
import { Trainee, Supervisor, SupervisorInput } from "@/types";
import { sanitizeInput, validateName, validateInstitution, isValidEmail, isValidPhone, phoneCharsOnly } from "@/lib/sanitize";

interface Props {
  trainee: Trainee;
  onClose: () => void;
  onUpdated: () => void;
}

const SUFFIX_OPTIONS = ["", "JR.", "SR.", "II", "III", "IV", "V", "VI", "VII", "VIII"] as const;

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
  const [lastName, setLastName] = useState(trainee.lastName.toUpperCase());
  const [firstName, setFirstName] = useState(trainee.firstName.toUpperCase());
  const [middleName, setMiddleName] = useState((trainee.middleName ?? "").toUpperCase());
  const [suffix, setSuffix] = useState((trainee.suffix ?? "").toUpperCase());
  const [email, setEmail] = useState(trainee.email);
  const [contactNumber, setContactNumber] = useState(trainee.contactNumber);
  const [school, setSchool] = useState(trainee.school.toUpperCase());
  const [companyName, setCompanyName] = useState(trainee.companyName.toUpperCase());
  const [requiredHours, setRequiredHours] = useState(String(trainee.requiredHours));

  // ── Existing supervisors (from DB) ──────────────────────────
  const [existingSupervisors, setExistingSupervisors] = useState<Supervisor[]>([]);
  // Edited copies keyed by id
  const [editedSupervisors, setEditedSupervisors] = useState<Record<string, SupervisorInput>>({});
  // IDs marked for deletion
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());

  // ── New supervisors to add ──────────────────────────────────
  const [newSupervisors, setNewSupervisors] = useState<SupervisorInput[]>([]);

  // ── Email verification (only when email changes) ────────────
  const originalEmail = trainee.email;
  const [emailVerified, setEmailVerified] = useState(false);
  const [verificationToken, setVerificationToken] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailCodeSent, setEmailCodeSent] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [emailMsg, setEmailMsg] = useState("");

  const emailChanged = email !== originalEmail;

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // ── Confirmation / result modals ────────────────────────────
  type FieldChange = { label: string; oldVal: string; newVal: string };
  const [pendingChanges, setPendingChanges] = useState<FieldChange[]>([]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saveResult, setSaveResult] = useState<"success" | "cancelled" | null>(null);

  // Load existing supervisors
  const loadSupervisors = useCallback(async () => {
    try {
      const sups = await fetchSupervisors(trainee.id);
      setExistingSupervisors(sups);
      // Seed editable copies
      const map: Record<string, SupervisorInput> = {};
      for (const s of sups) {
        map[s.id] = {
          lastName: s.lastName.toUpperCase(),
          firstName: s.firstName.toUpperCase(),
          middleName: (s.middleName ?? "").toUpperCase(),
          suffix: (s.suffix ?? "").toUpperCase(),
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

  // ── Email change resets verification ──────────────────────
  const handleEmailChange = (val: string) => {
    setEmail(val);
    if (emailVerified || emailCodeSent) {
      setEmailVerified(false);
      setVerificationToken("");
      setEmailCode("");
      setEmailCodeSent(false);
      setEmailMsg("");
    }
  };

  const handleSendVerification = async () => {
    setError("");
    setEmailMsg("");
    if (!email || !isValidEmail(email)) {
      setError("Please enter a valid email address first.");
      return;
    }
    setEmailSending(true);
    try {
      await sendEmailVerification(email);
      setEmailCodeSent(true);
      setEmailMsg("Verification code sent! Check your inbox.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to send verification code.");
    } finally {
      setEmailSending(false);
    }
  };

  const handleVerifyEmailCode = async () => {
    setError("");
    setEmailMsg("");
    if (emailCode.length !== 6) {
      setError("Please enter the 6-digit verification code.");
      return;
    }
    setEmailSending(true);
    try {
      const res = await verifyEmailCode(email, emailCode);
      setVerificationToken(res.verificationToken);
      setEmailVerified(true);
      setEmailMsg("Email verified!");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invalid or expired code.");
    } finally {
      setEmailSending(false);
    }
  };

  // ── Submit ──────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!lastName || !firstName || !email || !contactNumber || !school || !companyName || !requiredHours) {
      setError("All required fields must be filled.");
      return;
    }

    // Content-quality checks
    const lnErr = validateName("Last name", lastName, true);    if (lnErr) { setError(lnErr); return; }
    const fnErr = validateName("First name", firstName, true);   if (fnErr) { setError(fnErr); return; }
    const mnErr = validateName("Middle name", middleName, false); if (mnErr) { setError(mnErr); return; }
    if (!isValidEmail(email)) { setError("Please enter a valid email address (e.g. name@example.com)."); return; }
    if (emailChanged && !emailVerified) { setError("Please verify the new email address before saving."); return; }
    if (!phoneCharsOnly(contactNumber)) { setError("Contact number must contain only digits, +, -, (, ), and spaces."); return; }
    if (!isValidPhone(contactNumber)) { setError("Contact number must have at least 7 digits."); return; }
    const schErr = validateInstitution("School", school);       if (schErr) { setError(schErr); return; }
    const coErr = validateInstitution("Company name", companyName); if (coErr) { setError(coErr); return; }

    // Validate edited existing supervisors (not deleted)
    for (const sup of existingSupervisors) {
      if (deletedIds.has(sup.id)) continue;
      const s = editedSupervisors[sup.id];
      const sLn = validateName(`Supervisor "${sup.displayName}" last name`, s.lastName, true);  if (sLn) { setError(sLn); return; }
      const sFn = validateName(`Supervisor "${sup.displayName}" first name`, s.firstName, true); if (sFn) { setError(sFn); return; }
      const sMn = validateName(`Supervisor "${sup.displayName}" middle name`, s.middleName ?? "", false); if (sMn) { setError(sMn); return; }
      if (!s.contactNumber?.trim() && !s.email?.trim()) {
        setError(`Supervisor "${sup.displayName}": At least one of Contact Number or Email is required.`);
        return;
      }
    }

    // Validate new supervisors
    for (let i = 0; i < newSupervisors.length; i++) {
      const s = newSupervisors[i];
      const sLn = validateName(`New Supervisor #${i + 1} last name`, s.lastName, true);  if (sLn) { setError(sLn); return; }
      const sFn = validateName(`New Supervisor #${i + 1} first name`, s.firstName, true); if (sFn) { setError(sFn); return; }
      const sMn = validateName(`New Supervisor #${i + 1} middle name`, s.middleName ?? "", false); if (sMn) { setError(sMn); return; }
      if (!s.contactNumber?.trim() && !s.email?.trim()) {
        setError(`New Supervisor #${i + 1}: At least one of Contact Number or Email is required.`);
        return;
      }
    }

    // ── Build diff of changed fields ────────────────────────
    const changes: FieldChange[] = [];
    const cmp = (label: string, oldV: string, newV: string) => {
      if (oldV !== newV) changes.push({ label, oldVal: oldV || "(empty)", newVal: newV || "(empty)" });
    };
    cmp("Last Name", trainee.lastName, lastName);
    cmp("First Name", trainee.firstName, firstName);
    cmp("Middle Name", trainee.middleName ?? "", middleName);
    cmp("Suffix", trainee.suffix ?? "", suffix);
    cmp("Email", trainee.email, email);
    cmp("Contact Number", trainee.contactNumber, contactNumber);
    cmp("School", trainee.school, school);
    cmp("Company Name", trainee.companyName, companyName);
    cmp("Required Hours", String(trainee.requiredHours), requiredHours);

    // Supervisor changes
    for (const sup of existingSupervisors) {
      if (deletedIds.has(sup.id)) {
        changes.push({ label: `Remove Supervisor`, oldVal: sup.displayName, newVal: "(deleted)" });
        continue;
      }
      const ed = editedSupervisors[sup.id];
      const prefix = `Supervisor "${sup.displayName}"`;
      cmp(`${prefix} Last Name`, sup.lastName, ed.lastName);
      cmp(`${prefix} First Name`, sup.firstName, ed.firstName);
      cmp(`${prefix} Middle Name`, sup.middleName ?? "", ed.middleName ?? "");
      cmp(`${prefix} Suffix`, sup.suffix ?? "", ed.suffix ?? "");
      cmp(`${prefix} Contact`, sup.contactNumber ?? "", ed.contactNumber ?? "");
      cmp(`${prefix} Email`, sup.email ?? "", ed.email ?? "");
    }

    for (let i = 0; i < newSupervisors.length; i++) {
      const s = newSupervisors[i];
      const name = `${s.firstName} ${s.lastName}`.trim() || `#${i + 1}`;
      changes.push({ label: "Add Supervisor", oldVal: "(none)", newVal: name });
    }

    if (changes.length === 0) {
      setError("No changes detected.");
      return;
    }

    setPendingChanges(changes);
    setShowConfirm(true);
  };

  // ── Execute the actual save ─────────────────────────────────
  const executeSave = async () => {
    setShowConfirm(false);
    setLoading(true);
    try {
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
        ...(emailChanged ? { verificationToken } : {}),
      });

      for (const id of deletedIds) {
        await deleteSupervisor(id);
      }

      for (const sup of existingSupervisors) {
        if (deletedIds.has(sup.id)) continue;
        await updateSupervisor(sup.id, editedSupervisors[sup.id]);
      }

      for (const s of newSupervisors) {
        await createSupervisor(trainee.id, s);
      }

      setSaveResult("success");
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
          <input value={s.lastName} onChange={(e) => onChange("lastName", sanitizeInput(e.target.value).toUpperCase())} style={{ textTransform: "uppercase" }} />
        </div>
        <div className="form-group" style={{ marginBottom: "0.4rem" }}>
          <label>First Name *</label>
          <input value={s.firstName} onChange={(e) => onChange("firstName", sanitizeInput(e.target.value).toUpperCase())} style={{ textTransform: "uppercase" }} />
        </div>
        <div className="form-group" style={{ marginBottom: "0.4rem" }}>
          <label>Middle Name</label>
          <input value={s.middleName ?? ""} onChange={(e) => onChange("middleName", sanitizeInput(e.target.value).toUpperCase())} style={{ textTransform: "uppercase" }} />
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
          <input value={s.contactNumber ?? ""} onChange={(e) => onChange("contactNumber", sanitizeInput(e.target.value))} />
        </div>
        <div className="form-group" style={{ marginBottom: "0.4rem" }}>
          <label>Email</label>
          <input type="email" value={s.email ?? ""} onChange={(e) => onChange("email", e.target.value)} />
        </div>
      </div>
    </div>
  );

  return (
    <>
    {/* ── Confirmation modal (review changes) ────────────── */}
    {showConfirm && (
      <div className="modal-overlay" style={{ zIndex: 1100 }} onClick={() => { setShowConfirm(false); setSaveResult("cancelled"); }}>
        <div className="modal-content" style={{ maxWidth: 500, maxHeight: "80vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
          <h2 style={{ marginBottom: "0.5rem" }}>Confirm Changes</h2>
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
            The following {pendingChanges.length} field{pendingChanges.length > 1 ? "s" : ""} will be updated:
          </p>
          <div style={{ background: "var(--bg)", borderRadius: "6px", padding: "0.75rem 1rem", marginBottom: "1rem", fontSize: "0.85rem" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                  <th style={{ padding: "0.3rem 0.5rem", fontWeight: 600 }}>Field</th>
                  <th style={{ padding: "0.3rem 0.5rem", fontWeight: 600 }}>Old Value</th>
                  <th style={{ padding: "0.3rem 0.5rem", fontWeight: 600 }}>New Value</th>
                </tr>
              </thead>
              <tbody>
                {pendingChanges.map((c, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "0.35rem 0.5rem", fontWeight: 500 }}>{c.label}</td>
                    <td style={{ padding: "0.35rem 0.5rem", color: "var(--danger)", wordBreak: "break-word" }}>{c.oldVal}</td>
                    <td style={{ padding: "0.35rem 0.5rem", color: "#16a34a", wordBreak: "break-word" }}>{c.newVal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
            <button className="btn btn-outline" onClick={() => { setShowConfirm(false); setSaveResult("cancelled"); }}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={executeSave} disabled={loading}>
              {loading ? "Saving…" : "Confirm"}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* ── Save result modal ──────────────────────────────── */}
    {saveResult && (
      <div className="modal-overlay" style={{ zIndex: 1200 }} onClick={() => { if (saveResult === "success") onUpdated(); setSaveResult(null); }}>
        <div className="modal-content" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
          {saveResult === "success" ? (
            <>
              <h2 style={{ marginBottom: "0.5rem", color: "#16a34a" }}>Changes Saved</h2>
              <p style={{ fontSize: "0.9rem", marginBottom: "1rem" }}>
                All changes to <strong>{trainee.displayName}</strong> have been saved successfully.
              </p>
            </>
          ) : (
            <>
              <h2 style={{ marginBottom: "0.5rem", color: "var(--text-muted)" }}>Edit Cancelled</h2>
              <p style={{ fontSize: "0.9rem", marginBottom: "1rem" }}>No changes were saved. You can continue editing.</p>
            </>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="btn btn-primary" onClick={() => { if (saveResult === "success") onUpdated(); setSaveResult(null); }}>OK</button>
          </div>
        </div>
      </div>
    )}

    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 560, maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: "1rem" }}>Edit Trainee</h2>

        <form onSubmit={handleSubmit}>
          {/* ── Name fields ──────────────────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
            <div className="form-group">
              <label>Last Name *</label>
              <input value={lastName} onChange={(e) => setLastName(sanitizeInput(e.target.value).toUpperCase())} style={{ textTransform: "uppercase" }} />
            </div>
            <div className="form-group">
              <label>First Name *</label>
              <input value={firstName} onChange={(e) => setFirstName(sanitizeInput(e.target.value).toUpperCase())} style={{ textTransform: "uppercase" }} />
            </div>
            <div className="form-group">
              <label>Middle Name</label>
              <input value={middleName} onChange={(e) => setMiddleName(sanitizeInput(e.target.value).toUpperCase())} style={{ textTransform: "uppercase" }} />
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
              <label>Email * {emailChanged && emailVerified && <span style={{ color: "#16a34a", fontSize: "0.8rem" }}>✓ Verified</span>}</label>
              <div style={{ display: "flex", gap: "0.35rem" }}>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => handleEmailChange(e.target.value)}
                  style={{ flex: 1, ...(emailChanged && emailVerified ? { borderColor: "#16a34a" } : {}) }}
                  disabled={emailChanged && emailVerified}
                />
                {emailChanged && !emailVerified && (
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ fontSize: "0.78rem", padding: "0.3rem 0.6rem", whiteSpace: "nowrap" }}
                    onClick={handleSendVerification}
                    disabled={emailSending}
                  >
                    {emailSending ? "Sending…" : emailCodeSent ? "Resend" : "Verify"}
                  </button>
                )}
                {emailChanged && emailVerified && (
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ fontSize: "0.78rem", padding: "0.3rem 0.6rem", whiteSpace: "nowrap" }}
                    onClick={() => handleEmailChange(email)}
                  >
                    Change
                  </button>
                )}
              </div>
              {emailChanged && emailCodeSent && !emailVerified && (
                <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.35rem" }}>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={emailCode}
                    onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, ""))}
                    placeholder="6-digit code"
                    style={{ flex: 1, letterSpacing: "0.3em", textAlign: "center", fontSize: "1rem" }}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ fontSize: "0.78rem", padding: "0.3rem 0.6rem", whiteSpace: "nowrap" }}
                    onClick={handleVerifyEmailCode}
                    disabled={emailSending}
                  >
                    {emailSending ? "Verifying…" : "Confirm"}
                  </button>
                </div>
              )}
              {emailMsg && (
                <span style={{ fontSize: "0.78rem", marginTop: "0.25rem", color: emailVerified ? "#16a34a" : "var(--primary)" }}>
                  {emailMsg}
                </span>
              )}
            </div>
            <div className="form-group">
              <label>Contact Number *</label>
              <input value={contactNumber} onChange={(e) => setContactNumber(sanitizeInput(e.target.value))} />
            </div>
          </div>

          {/* ── School, Company, Hours ────────────────── */}
          <div className="form-group">
            <label>School *</label>
            <input value={school} onChange={(e) => setSchool(sanitizeInput(e.target.value).toUpperCase())} style={{ textTransform: "uppercase" }} />
          </div>

          <div className="form-group">
            <label>Company / Institution Name *</label>
            <input value={companyName} onChange={(e) => setCompanyName(sanitizeInput(e.target.value).toUpperCase())} style={{ textTransform: "uppercase" }} />
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
    </>
  );
}
