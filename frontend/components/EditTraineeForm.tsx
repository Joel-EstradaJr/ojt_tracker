"use client";

// ============================================================
// EditTraineeForm -- modal form to edit trainee info & supervisors
// ============================================================

import { useState, useEffect, useCallback } from "react";
import { updateTrainee, fetchSupervisors, createSupervisor, updateSupervisor, deleteSupervisor, sendEmailVerification, verifyEmailCode, resendTempPassword } from "@/lib/api";
import { useActionGuard } from "@/lib/useActionGuard";
import { Trainee, Supervisor, SupervisorInput } from "@/types";
import { sanitizeInput, validateName, validateInstitution, isValidEmail, isValidPhone, phoneCharsOnly } from "@/lib/sanitize";
import { DEFAULT_WORK_SCHEDULE, WorkSchedule } from "@/lib/ph-holidays";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

interface Props {
  trainee: Trainee;
  onClose: () => void;
  onUpdated: () => void;
}

const SUFFIX_OPTIONS = ["", "JR.", "SR.", "II", "III", "IV", "V", "VI", "VII", "VIII"] as const;

const emptySupervisor = (): SupervisorInput => ({
  lastName: "", firstName: "", middleName: "", suffix: "", contactNumber: "", email: "",
});

const normalizeTime = (value?: string): string => {
  if (!value) return "";
  const [h = "", m = ""] = value.split(":");
  if (!h || !m) return "";
  return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
};

const normalizeWorkSchedule = (schedule?: WorkSchedule): WorkSchedule => {
  const source = schedule ?? DEFAULT_WORK_SCHEDULE;
  const normalized: WorkSchedule = {};

  for (let day = 0; day < 7; day++) {
    const key = String(day);
    const daySchedule = source[key];
    if (!daySchedule) continue;

    const start = normalizeTime(daySchedule.start);
    const end = normalizeTime(daySchedule.end);
    if (!start || !end) continue;

    normalized[key] = { start, end };
  }

  return normalized;
};

const workSchedulesEqual = (a: WorkSchedule, b: WorkSchedule): boolean => {
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return false;

  for (let i = 0; i < keysA.length; i++) {
    if (keysA[i] !== keysB[i]) return false;
    if (a[keysA[i]].start !== b[keysB[i]].start) return false;
    if (a[keysA[i]].end !== b[keysB[i]].end) return false;
  }

  return true;
};

const formatWorkSchedule = (schedule: WorkSchedule): string => {
  const keys = Object.keys(schedule).sort((a, b) => Number(a) - Number(b));
  if (keys.length === 0) return "(none)";
  return keys.map((k) => `${DAY_LABELS[Number(k)]} ${schedule[k].start}-${schedule[k].end}`).join(",\n");
};

export default function EditTraineeForm({ trainee, onClose, onUpdated }: Props) {
  const { runGuarded } = useActionGuard();
  const [role, setRole] = useState<"admin" | "trainee">(trainee.role);
  const [lastName, setLastName] = useState(trainee.lastName.toUpperCase());
  const [firstName, setFirstName] = useState(trainee.firstName.toUpperCase());
  const [middleName, setMiddleName] = useState((trainee.middleName ?? "").toUpperCase());
  const [suffix, setSuffix] = useState((trainee.suffix ?? "").toUpperCase());
  const [email, setEmail] = useState(trainee.email);
  const [contactNumber, setContactNumber] = useState(trainee.contactNumber);
  const [school, setSchool] = useState(trainee.school.toUpperCase());
  const [companyName, setCompanyName] = useState(trainee.companyName.toUpperCase());
  const [requiredHours, setRequiredHours] = useState(String(trainee.requiredHours));
  const [workSchedule, setWorkSchedule] = useState<WorkSchedule>(
    (trainee.workSchedule as WorkSchedule | undefined) ?? { ...DEFAULT_WORK_SCHEDULE }
  );

  const toggleDay = (day: number) => {
    setWorkSchedule((prev) => {
      const copy = { ...prev };
      if (String(day) in copy) { delete copy[String(day)]; } else { copy[String(day)] = { start: "08:00", end: "17:00" }; }
      return copy;
    });
  };
  const updateDayTime = (day: number, field: "start" | "end", value: string) => {
    setWorkSchedule((prev) => ({ ...prev, [String(day)]: { ...prev[String(day)], [field]: value } }));
  };

  const [existingSupervisors, setExistingSupervisors] = useState<Supervisor[]>([]);
  const [editedSupervisors, setEditedSupervisors] = useState<Record<string, SupervisorInput>>({});
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [newSupervisors, setNewSupervisors] = useState<SupervisorInput[]>([]);

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

  type FieldChange = { label: string; oldVal: string; newVal: string };
  const [pendingChanges, setPendingChanges] = useState<FieldChange[]>([]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saveResult, setSaveResult] = useState<"success" | "cancelled" | null>(null);

  // Resend temp password
  const [resendLoading, setResendLoading] = useState(false);
  const [resendMsg, setResendMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const loadSupervisors = useCallback(async () => {
    try {
      const sups = await fetchSupervisors(trainee.id);
      setExistingSupervisors(sups);
      const map: Record<string, SupervisorInput> = {};
      for (const s of sups) {
        map[s.id] = { lastName: s.lastName.toUpperCase(), firstName: s.firstName.toUpperCase(), middleName: (s.middleName ?? "").toUpperCase(), suffix: (s.suffix ?? "").toUpperCase(), contactNumber: s.contactNumber ?? "", email: s.email ?? "" };
      }
      setEditedSupervisors(map);
    } catch (err) { console.error("Failed to load supervisors:", err); }
  }, [trainee.id]);

  useEffect(() => { loadSupervisors(); }, [loadSupervisors]);

  const updateExistingField = (id: string, field: keyof SupervisorInput, value: string) => {
    setEditedSupervisors((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };
  const toggleDeleteExisting = (id: string) => {
    setDeletedIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const addNewSupervisor = () => setNewSupervisors([...newSupervisors, emptySupervisor()]);
  const removeNewSupervisor = (idx: number) => setNewSupervisors(newSupervisors.filter((_, i) => i !== idx));
  const updateNewField = (idx: number, field: keyof SupervisorInput, value: string) => {
    const updated = [...newSupervisors]; updated[idx] = { ...updated[idx], [field]: value }; setNewSupervisors(updated);
  };

  const handleEmailChange = (val: string) => {
    setEmail(val);
    if (emailVerified || emailCodeSent) { setEmailVerified(false); setVerificationToken(""); setEmailCode(""); setEmailCodeSent(false); setEmailMsg(""); }
  };
  const handleSendVerification = async () => {
    await runGuarded("edit-email-send", async () => {
      setError(""); setEmailMsg("");
      if (!email || !isValidEmail(email)) { setError("Please enter a valid email address first."); return; }
      setEmailSending(true);
      try { await sendEmailVerification(email); setEmailCodeSent(true); setEmailMsg("Verification code sent! Check your inbox."); }
      catch (err: unknown) { setError(err instanceof Error ? err.message : "Failed to send verification code."); }
      finally { setEmailSending(false); }
    });
  };
  const handleVerifyEmailCode = async () => {
    await runGuarded("edit-email-verify", async () => {
      setError(""); setEmailMsg("");
      if (emailCode.length !== 6) { setError("Please enter the 6-digit verification code."); return; }
      setEmailSending(true);
      try { const res = await verifyEmailCode(email, emailCode); setVerificationToken(res.verificationToken); setEmailVerified(true); setEmailMsg("Email verified!"); }
      catch (err: unknown) { setError(err instanceof Error ? err.message : "Invalid or expired code."); }
      finally { setEmailSending(false); }
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError("");
    if (!lastName || !firstName || !email || !contactNumber || !school || !companyName || !requiredHours) { setError("All required fields must be filled."); return; }
    const lnErr = validateName("Last name", lastName, true); if (lnErr) { setError(lnErr); return; }
    const fnErr = validateName("First name", firstName, true); if (fnErr) { setError(fnErr); return; }
    const mnErr = validateName("Middle name", middleName, false); if (mnErr) { setError(mnErr); return; }
    if (!isValidEmail(email)) { setError("Please enter a valid email address (e.g. name@example.com)."); return; }
    if (emailChanged && !emailVerified) { setError("Please verify the new email address before saving."); return; }
    if (!phoneCharsOnly(contactNumber)) { setError("Contact number must contain only digits, +, -, (, ), and spaces."); return; }
    if (!isValidPhone(contactNumber)) { setError("Contact number must have at least 7 digits."); return; }
    const schErr = validateInstitution("School", school); if (schErr) { setError(schErr); return; }
    const coErr = validateInstitution("Company name", companyName); if (coErr) { setError(coErr); return; }

    for (const sup of existingSupervisors) {
      if (deletedIds.has(sup.id)) continue;
      const s = editedSupervisors[sup.id];
      const sLn = validateName(`Supervisor "${sup.displayName}" last name`, s.lastName, true); if (sLn) { setError(sLn); return; }
      const sFn = validateName(`Supervisor "${sup.displayName}" first name`, s.firstName, true); if (sFn) { setError(sFn); return; }
      const sMn = validateName(`Supervisor "${sup.displayName}" middle name`, s.middleName ?? "", false); if (sMn) { setError(sMn); return; }
      if (!s.contactNumber?.trim() && !s.email?.trim()) { setError(`Supervisor "${sup.displayName}": At least one of Contact Number or Email is required.`); return; }
    }
    for (let i = 0; i < newSupervisors.length; i++) {
      const s = newSupervisors[i];
      const sLn = validateName(`New Supervisor #${i + 1} last name`, s.lastName, true); if (sLn) { setError(sLn); return; }
      const sFn = validateName(`New Supervisor #${i + 1} first name`, s.firstName, true); if (sFn) { setError(sFn); return; }
      const sMn = validateName(`New Supervisor #${i + 1} middle name`, s.middleName ?? "", false); if (sMn) { setError(sMn); return; }
      if (!s.contactNumber?.trim() && !s.email?.trim()) { setError(`New Supervisor #${i + 1}: At least one of Contact Number or Email is required.`); return; }
    }

    // Check for duplicate supervisors (existing non-deleted + new, by full name)
    const supKeys = new Set<string>();
    for (const sup of existingSupervisors) {
      if (deletedIds.has(sup.id)) continue;
      const s = editedSupervisors[sup.id];
      const key = [s.firstName, s.middleName, s.lastName, s.suffix].map((v) => (v ?? "").trim().toLowerCase()).join("|");
      if (supKeys.has(key)) {
        const dupName = [s.firstName, s.middleName, s.lastName, s.suffix].filter(Boolean).join(" ");
        setError(`Duplicate supervisor: "${dupName}". Each supervisor must be unique per trainee.`);
        return;
      }
      supKeys.add(key);
    }
    for (let i = 0; i < newSupervisors.length; i++) {
      const s = newSupervisors[i];
      const key = [s.firstName, s.middleName, s.lastName, s.suffix].map((v) => (v ?? "").trim().toLowerCase()).join("|");
      if (supKeys.has(key)) {
        const dupName = [s.firstName, s.middleName, s.lastName, s.suffix].filter(Boolean).join(" ");
        setError(`Duplicate supervisor: "${dupName}". Each supervisor must be unique per trainee.`);
        return;
      }
      supKeys.add(key);
    }

    const changes: FieldChange[] = [];
    const cmp = (label: string, oldV: string, newV: string) => { if (oldV !== newV) changes.push({ label, oldVal: oldV || "(empty)", newVal: newV || "(empty)" }); };
    cmp("Last Name", trainee.lastName, lastName); cmp("First Name", trainee.firstName, firstName);
    cmp("Middle Name", trainee.middleName ?? "", middleName); cmp("Suffix", trainee.suffix ?? "", suffix);
    cmp("Email", trainee.email, email); cmp("Contact Number", trainee.contactNumber, contactNumber);
    cmp("School", trainee.school, school); cmp("Company Name", trainee.companyName, companyName);
    cmp("Required Hours", String(trainee.requiredHours), requiredHours);
    cmp("Role", trainee.role, role);
    const originalWorkSchedule = normalizeWorkSchedule(trainee.workSchedule as WorkSchedule | undefined);
    const currentWorkSchedule = normalizeWorkSchedule(workSchedule);
    if (!workSchedulesEqual(originalWorkSchedule, currentWorkSchedule)) {
      changes.push({
        label: "Work Schedule",
        oldVal: formatWorkSchedule(originalWorkSchedule),
        newVal: formatWorkSchedule(currentWorkSchedule),
      });
    }

    for (const sup of existingSupervisors) {
      if (deletedIds.has(sup.id)) { changes.push({ label: "Remove Supervisor", oldVal: sup.displayName, newVal: "(deleted)" }); continue; }
      const ed = editedSupervisors[sup.id]; const prefix = `Supervisor "${sup.displayName}"`;
      cmp(`${prefix} Last Name`, sup.lastName, ed.lastName); cmp(`${prefix} First Name`, sup.firstName, ed.firstName);
      cmp(`${prefix} Middle Name`, sup.middleName ?? "", ed.middleName ?? ""); cmp(`${prefix} Suffix`, sup.suffix ?? "", ed.suffix ?? "");
      cmp(`${prefix} Contact`, sup.contactNumber ?? "", ed.contactNumber ?? ""); cmp(`${prefix} Email`, sup.email ?? "", ed.email ?? "");
    }
    for (let i = 0; i < newSupervisors.length; i++) {
      const s = newSupervisors[i]; const name = `${s.firstName} ${s.lastName}`.trim() || `#${i + 1}`;
      changes.push({ label: "Add Supervisor", oldVal: "(none)", newVal: name });
    }
    if (changes.length === 0) { setError("No changes detected."); return; }
    setPendingChanges(changes); setShowConfirm(true);
  };

  const executeSave = async () => {
    await runGuarded("edit-save", async () => {
      setShowConfirm(false); setLoading(true);
      try {
        await updateTrainee(trainee.id, { role, lastName, firstName, middleName: middleName || undefined, suffix: suffix || undefined, email, contactNumber, school, companyName, requiredHours: Number(requiredHours), workSchedule: Object.keys(workSchedule).length > 0 ? workSchedule : undefined, ...(emailChanged ? { verificationToken } : {}) });
        for (const id of deletedIds) { await deleteSupervisor(id); }
        for (const sup of existingSupervisors) { if (deletedIds.has(sup.id)) continue; await updateSupervisor(sup.id, editedSupervisors[sup.id]); }
        for (const s of newSupervisors) { await createSupervisor(trainee.id, s); }
        setSaveResult("success");
      } catch (err: unknown) { setError(err instanceof Error ? err.message : "Failed to update trainee."); }
      finally { setLoading(false); }
    });
  };

  const handleResendTempPassword = async () => {
    await runGuarded("edit-resend-temp", async () => {
      setResendLoading(true);
      setResendMsg(null);
      try {
        const res = await resendTempPassword(trainee.id);
        setResendMsg({ type: "success", text: res.message });
      } catch (err: unknown) {
        setResendMsg({ type: "error", text: err instanceof Error ? err.message : "Failed to resend." });
      } finally {
        setResendLoading(false);
      }
    });
  };

  const renderSupervisorFields = (
    s: SupervisorInput,
    onChange: (field: keyof SupervisorInput, value: string) => void,
    onRemove: () => void,
    isDeleted?: boolean,
    label?: string
  ) => (
    <div style={{ background: "var(--bg-subtle)", padding: "0.75rem", borderRadius: "var(--radius-sm)", marginBottom: "0.5rem", position: "relative", opacity: isDeleted ? 0.45 : 1, pointerEvents: isDeleted ? "none" : "auto", border: "1px solid var(--border)" }}>
      {label && <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontWeight: 600 }}>{label}</span>}
      <button type="button" onClick={(e) => { e.preventDefault(); onRemove(); }}
        style={{ position: "absolute", top: "0.4rem", right: "0.5rem", background: "none", border: "none", color: isDeleted ? "var(--primary)" : "var(--danger)", fontWeight: 700, fontSize: isDeleted ? "0.75rem" : "1rem", cursor: "pointer" }}>
        {isDeleted ? "Undo" : "\u00d7"}
      </button>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem" }}>
        <div className="form-group" style={{ marginBottom: "0.4rem" }}><label>Last Name *</label><input value={s.lastName} onChange={(e) => onChange("lastName", sanitizeInput(e.target.value).toUpperCase())} style={{ textTransform: "uppercase" }} /></div>
        <div className="form-group" style={{ marginBottom: "0.4rem" }}><label>First Name *</label><input value={s.firstName} onChange={(e) => onChange("firstName", sanitizeInput(e.target.value).toUpperCase())} style={{ textTransform: "uppercase" }} /></div>
        <div className="form-group" style={{ marginBottom: "0.4rem" }}><label>Middle Name</label><input value={s.middleName ?? ""} onChange={(e) => onChange("middleName", sanitizeInput(e.target.value).toUpperCase())} style={{ textTransform: "uppercase" }} /></div>
        <div className="form-group" style={{ marginBottom: "0.4rem" }}><label>Suffix</label><select value={s.suffix ?? ""} onChange={(e) => onChange("suffix", e.target.value)}>{SUFFIX_OPTIONS.map((opt) => (<option key={opt} value={opt}>{opt || "None"}</option>))}</select></div>
        <div className="form-group" style={{ marginBottom: "0.4rem" }}><label>Contact Number</label><input value={s.contactNumber ?? ""} onChange={(e) => onChange("contactNumber", sanitizeInput(e.target.value))} /></div>
        <div className="form-group" style={{ marginBottom: "0.4rem" }}><label>Email</label><input type="email" value={s.email ?? ""} onChange={(e) => onChange("email", e.target.value)} /></div>
      </div>
    </div>
  );

  return (
    <>
      {/* Confirmation modal */}
      {showConfirm && (
        <div className="modal-overlay" style={{ zIndex: 1100 }} onClick={() => { setShowConfirm(false); setSaveResult("cancelled"); }}>
          <div className="modal-content" style={{ maxWidth: 500, maxHeight: "80vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
              <div style={{ width: "2.5rem", height: "2.5rem", borderRadius: "var(--radius-sm)", background: "var(--warning-light)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--warning-text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
              </div>
              <div>
                <h2 style={{ fontSize: "1.15rem", marginBottom: "0.1rem" }}>Confirm Changes</h2>
                <p style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>{pendingChanges.length} field{pendingChanges.length > 1 ? "s" : ""} will be updated</p>
              </div>
            </div>
            <div style={{ background: "var(--bg-subtle)", borderRadius: "var(--radius-sm)", padding: "0.75rem 1rem", marginBottom: "1rem", fontSize: "0.85rem", border: "1px solid var(--border)", overflowX: "auto" }}>
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
                      <td style={{ padding: "0.35rem 0.5rem", color: "var(--danger)", wordBreak: "break-word", whiteSpace: "pre-line" }}>{c.oldVal}</td>
                      <td style={{ padding: "0.35rem 0.5rem", color: "var(--success-text)", wordBreak: "break-word", whiteSpace: "pre-line" }}>{c.newVal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button className="btn btn-outline" onClick={() => { setShowConfirm(false); setSaveResult("cancelled"); }}>Cancel</button>
              <button className="btn btn-primary" onClick={executeSave} disabled={loading}>{loading ? "Saving\u2026" : "Confirm"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Save result modal */}
      {saveResult && (
        <div className="modal-overlay" style={{ zIndex: 1200 }} onClick={() => { if (saveResult === "success") onUpdated(); setSaveResult(null); }}>
          <div className="modal-content" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
              <div style={{ width: "2.5rem", height: "2.5rem", borderRadius: "var(--radius-sm)", background: saveResult === "success" ? "var(--success-light)" : "var(--bg-subtle)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {saveResult === "success" ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
                )}
              </div>
              <div>
                <h2 style={{ fontSize: "1.15rem", color: saveResult === "success" ? "var(--success-text)" : "var(--text-muted)" }}>{saveResult === "success" ? "Changes Saved" : "Edit Cancelled"}</h2>
                <p style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
                  {saveResult === "success" ? `All changes to ${trainee.displayName} saved.` : "No changes were saved. You can continue editing."}
                </p>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="btn btn-primary" onClick={() => { if (saveResult === "success") onUpdated(); setSaveResult(null); }}>OK</button>
            </div>
          </div>
        </div>
      )}

      {/* Main edit modal */}
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" style={{ maxWidth: 560, maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.25rem" }}>
            <div style={{ width: "2.5rem", height: "2.5rem", borderRadius: "var(--radius-sm)", background: "var(--accent-light)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
            </div>
            <div>
              <h2 style={{ fontSize: "1.15rem", marginBottom: "0.1rem" }}>Edit User</h2>
              <p style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>Update information for {trainee.displayName}</p>
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            {/* Resend Temporary Password — only for users who haven't set their password */}
            {trainee.mustChangePassword && (
              <div style={{ background: "var(--warning-light)", border: "1px solid var(--warning)", borderRadius: "var(--radius-sm)", padding: "0.75rem 1rem", marginBottom: "1rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--warning-text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                  <span style={{ fontSize: "0.82rem", color: "var(--warning-text)" }}>This user hasn&apos;t set their password yet.</span>
                </div>
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ fontSize: "0.78rem", padding: "0.35rem 0.7rem", whiteSpace: "nowrap", flexShrink: 0 }}
                  disabled={resendLoading}
                  onClick={handleResendTempPassword}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
                  {resendLoading ? "Sending…" : "Resend Temp Password"}
                </button>
              </div>
            )}
            {resendMsg && (
              <div style={{ padding: "0.5rem 0.75rem", borderRadius: "var(--radius-xs)", marginBottom: "0.75rem", fontSize: "0.82rem", background: resendMsg.type === "success" ? "var(--success-light)" : "var(--danger-light)", color: resendMsg.type === "success" ? "var(--success-text)" : "var(--danger)", border: `1px solid ${resendMsg.type === "success" ? "var(--success)" : "var(--danger)"}` }}>
                {resendMsg.text}
              </div>
            )}

            <div className="form-group">
              <label>Role *</label>
              <select value={role} onChange={(e) => setRole(e.target.value as "admin" | "trainee")}>
                <option value="trainee">Trainee</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
              <div className="form-group"><label>Last Name *</label><input value={lastName} onChange={(e) => setLastName(sanitizeInput(e.target.value).toUpperCase())} style={{ textTransform: "uppercase" }} /></div>
              <div className="form-group"><label>First Name *</label><input value={firstName} onChange={(e) => setFirstName(sanitizeInput(e.target.value).toUpperCase())} style={{ textTransform: "uppercase" }} /></div>
              <div className="form-group"><label>Middle Name</label><input value={middleName} onChange={(e) => setMiddleName(sanitizeInput(e.target.value).toUpperCase())} style={{ textTransform: "uppercase" }} /></div>
              <div className="form-group"><label>Suffix</label><select value={suffix} onChange={(e) => setSuffix(e.target.value)}>{SUFFIX_OPTIONS.map((opt) => (<option key={opt} value={opt}>{opt || "N/A"}</option>))}</select></div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
              <div className="form-group">
                <label>Email * {emailChanged && emailVerified && <span style={{ color: "var(--success-text)", fontSize: "0.8rem" }}>{"\u2713"} Verified</span>}</label>
                <div style={{ display: "flex", gap: "0.35rem" }}>
                  <input type="email" value={email} onChange={(e) => handleEmailChange(e.target.value)} style={{ flex: 1, ...(emailChanged && emailVerified ? { borderColor: "var(--success)" } : {}) }} disabled={emailChanged && emailVerified} />
                  {emailChanged && !emailVerified && (
                    <button type="button" className="btn btn-outline" style={{ fontSize: "0.78rem", padding: "0.3rem 0.6rem", whiteSpace: "nowrap" }} onClick={handleSendVerification} disabled={emailSending}>{emailSending ? "Sending\u2026" : emailCodeSent ? "Resend" : "Verify"}</button>
                  )}
                  {emailChanged && emailVerified && (
                    <button type="button" className="btn btn-outline" style={{ fontSize: "0.78rem", padding: "0.3rem 0.6rem", whiteSpace: "nowrap" }} onClick={() => handleEmailChange(email)}>Change</button>
                  )}
                </div>
                {emailChanged && emailCodeSent && !emailVerified && (
                  <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.35rem" }}>
                    <input type="text" inputMode="numeric" maxLength={6} value={emailCode} onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, ""))} placeholder="6-digit code" style={{ flex: 1, letterSpacing: "0.3em", textAlign: "center", fontSize: "1rem" }} />
                    <button type="button" className="btn btn-primary" style={{ fontSize: "0.78rem", padding: "0.3rem 0.6rem", whiteSpace: "nowrap" }} onClick={handleVerifyEmailCode} disabled={emailSending}>{emailSending ? "Verifying\u2026" : "Confirm"}</button>
                  </div>
                )}
                {emailMsg && <span style={{ fontSize: "0.78rem", marginTop: "0.25rem", color: emailVerified ? "var(--success-text)" : "var(--primary)" }}>{emailMsg}</span>}
              </div>
              <div className="form-group"><label>Contact Number *</label><input value={contactNumber} onChange={(e) => setContactNumber(sanitizeInput(e.target.value))} /></div>
            </div>

            <div className="form-group"><label>School *</label><input value={school} onChange={(e) => setSchool(sanitizeInput(e.target.value).toUpperCase())} style={{ textTransform: "uppercase" }} /></div>
            <div className="form-group"><label>Company / Institution Name *</label><input value={companyName} onChange={(e) => setCompanyName(sanitizeInput(e.target.value).toUpperCase())} style={{ textTransform: "uppercase" }} /></div>
            <div className="form-group"><label>Required Hours *</label><input type="number" min="1" value={requiredHours} onChange={(e) => setRequiredHours(e.target.value)} /></div>

            {/* Work Schedule */}
            <fieldset style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "1rem", marginBottom: "0.5rem" }}>
              <legend style={{ fontWeight: 600, fontSize: "0.9rem", padding: "0 0.5rem" }}>Work Schedule</legend>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
                {DAY_LABELS.map((label, idx) => (
                  <label key={idx} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: "0.85rem" }}>
                    <input type="checkbox" checked={String(idx) in workSchedule} onChange={() => toggleDay(idx)} />
                    {label}
                  </label>
                ))}
              </div>
              {Object.keys(workSchedule).sort((a, b) => Number(a) - Number(b)).map((dayNum) => (
                <div key={dayNum} style={{ display: "grid", gridTemplateColumns: "60px 1fr 1fr", gap: "0.5rem", alignItems: "center", marginBottom: "0.4rem" }}>
                  <span style={{ fontWeight: 500, fontSize: "0.85rem" }}>{DAY_LABELS[Number(dayNum)]}</span>
                  <input type="time" value={workSchedule[dayNum].start} onChange={(e) => updateDayTime(Number(dayNum), "start", e.target.value)} />
                  <input type="time" value={workSchedule[dayNum].end} onChange={(e) => updateDayTime(Number(dayNum), "end", e.target.value)} />
                </div>
              ))}
              {Object.keys(workSchedule).length === 0 && (
                <p style={{ color: "var(--danger)", fontSize: "0.82rem", margin: 0 }}>At least one work day is required.</p>
              )}
            </fieldset>

            {/* Supervisors section */}
            <div style={{ marginTop: "1rem", borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <label style={{ fontWeight: 600, fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                  SUPERVISORS
                </label>
                <button type="button" className="btn btn-outline" style={{ fontSize: "0.8rem", padding: "0.3rem 0.7rem", gap: "0.25rem" }} onClick={addNewSupervisor}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                  Add Supervisor
                </button>
              </div>
              {existingSupervisors.map((sup) => renderSupervisorFields(editedSupervisors[sup.id] ?? emptySupervisor(), (field, value) => updateExistingField(sup.id, field, value), () => toggleDeleteExisting(sup.id), deletedIds.has(sup.id)))}
              {newSupervisors.map((s, idx) => renderSupervisorFields(s, (field, value) => updateNewField(idx, field, value), () => removeNewSupervisor(idx), false, `New Supervisor #${idx + 1}`))}
              {existingSupervisors.length === 0 && newSupervisors.length === 0 && (
                <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>No supervisors assigned.</p>
              )}
            </div>

            {error && (
              <div style={{ padding: "0.6rem 0.85rem", borderRadius: "var(--radius-sm)", background: "var(--danger-light)", border: "1px solid var(--danger)", color: "var(--danger)", fontSize: "0.85rem", marginBottom: "0.75rem", marginTop: "0.5rem", display: "flex", alignItems: "flex-start", gap: "0.4rem" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: "0.1rem" }}><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
                {error}
              </div>
            )}

            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1rem" }}>
              <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={loading} style={{ gap: "0.35rem" }}>
                {loading ? "Saving\u2026" : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                    Save Changes
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}