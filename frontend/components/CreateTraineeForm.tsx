"use client";

// ============================================================
// CreateTraineeForm -- modal form to add a new OJT trainee
// ============================================================

import { useState } from "react";
import { createTrainee, sendEmailVerification, verifyEmailCode } from "@/lib/api";
import { useActionGuard } from "@/lib/useActionGuard";
import { SupervisorInput } from "@/types";
import { sanitizeInput, validateName, validateInstitution, isValidEmail, isValidPhone, phoneCharsOnly } from "@/lib/sanitize";
import { DEFAULT_WORK_SCHEDULE, WorkSchedule } from "@/lib/ph-holidays";
import RightSidebarDrawer from "@/components/RightSidebarDrawer";
import TimePicker from "@/components/TimePicker";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

interface Props {
  onClose?: () => void;
  onCreated: () => void;
  mode?: "modal" | "inline";
  title?: string;
  subtitle?: string;
  submitLabel?: string;
  showRoleField?: boolean;
  defaultRole?: "admin" | "trainee";
  formId?: string;
  showSubmitActions?: boolean;
  showFormHeader?: boolean;
}

const SUFFIX_OPTIONS = ["", "JR.", "SR.", "II", "III", "IV", "V", "VI", "VII", "VIII"] as const;

const emptySupervisor = (): SupervisorInput => ({
  lastName: "", firstName: "", middleName: "", suffix: "", contactNumber: "", email: "",
});

export default function CreateTraineeForm({
  onClose,
  onCreated,
  mode = "modal",
  title = "Add New User",
  subtitle = "Fill in the details below to register a new user.",
  submitLabel = "Create",
  showRoleField = true,
  defaultRole = "trainee",
  formId,
  showSubmitActions = true,
  showFormHeader = true,
}: Props) {
  const { runGuarded } = useActionGuard();
  const isModal = mode === "modal";
  const isAdminCreating = showRoleField; // admin dashboard passes showRoleField=true
  const [role, setRole] = useState<"admin" | "trainee">(defaultRole);
  const isTraineeRole = !showRoleField || role === "trainee";
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [suffix, setSuffix] = useState("");
  const [email, setEmail] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [school, setSchool] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [requiredHours, setRequiredHours] = useState("500");
  const [workSchedule, setWorkSchedule] = useState<WorkSchedule>({ ...DEFAULT_WORK_SCHEDULE });
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [supervisors, setSupervisors] = useState<SupervisorInput[]>([]);

  const toggleDay = (day: number) => {
    setWorkSchedule((prev) => {
      const copy = { ...prev };
      if (String(day) in copy) {
        delete copy[String(day)];
      } else {
        copy[String(day)] = { start: "08:00", end: "17:00" };
      }
      return copy;
    });
  };

  const updateDayTime = (day: number, field: "start" | "end", value: string) => {
    setWorkSchedule((prev) => ({
      ...prev,
      [String(day)]: { ...prev[String(day)], [field]: value },
    }));
  };

  const [emailVerified, setEmailVerified] = useState(false);
  const [verificationToken, setVerificationToken] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailCodeSent, setEmailCodeSent] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [emailMsg, setEmailMsg] = useState("");

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const addSupervisor = () => setSupervisors([...supervisors, emptySupervisor()]);
  const removeSupervisor = (idx: number) => setSupervisors(supervisors.filter((_, i) => i !== idx));
  const updateSupervisor = (idx: number, field: keyof SupervisorInput, value: string) => {
    const updated = [...supervisors];
    updated[idx] = { ...updated[idx], [field]: value };
    setSupervisors(updated);
  };

  const handleEmailChange = (val: string) => {
    setEmail(val);
    if (emailVerified || emailCodeSent) {
      setEmailVerified(false); setVerificationToken(""); setEmailCode("");
      setEmailCodeSent(false); setEmailMsg("");
    }
  };

  const handleSendVerification = async () => {
    await runGuarded("create-email-send", async () => {
      setError(""); setEmailMsg("");
      if (!email || !isValidEmail(email)) { setError("Please enter a valid email address first."); return; }
      setEmailSending(true);
      try { await sendEmailVerification(email); setEmailCodeSent(true); setEmailMsg("Verification code sent! Check your inbox."); }
      catch (err: unknown) { setError(err instanceof Error ? err.message : "Failed to send verification code."); }
      finally { setEmailSending(false); }
    });
  };

  const handleVerifyEmailCode = async () => {
    await runGuarded("create-email-verify", async () => {
      setError(""); setEmailMsg("");
      if (emailCode.length !== 6) { setError("Please enter the 6-digit verification code."); return; }
      setEmailSending(true);
      try { const res = await verifyEmailCode(email, emailCode); setVerificationToken(res.verificationToken); setEmailVerified(true); setEmailMsg("Email verified!"); }
      catch (err: unknown) { setError(err instanceof Error ? err.message : "Invalid or expired code."); }
      finally { setEmailSending(false); }
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await runGuarded("create-submit", async () => {
      setError("");
      if (!lastName || !firstName || !email || !contactNumber) {
        setError("All required fields must be filled."); return;
      }
      if (isTraineeRole && (!school || !companyName || !requiredHours)) {
        setError("All required fields must be filled."); return;
      }
      if (!isAdminCreating && (!password || !confirmPassword)) {
        setError("Password fields are required."); return;
      }
      if (showRoleField && !role) { setError("Role is required."); return; }
      if (!isAdminCreating && password !== confirmPassword) { setError("Passwords do not match."); return; }
      const lnErr = validateName("Last name", lastName, true); if (lnErr) { setError(lnErr); return; }
      const fnErr = validateName("First name", firstName, true); if (fnErr) { setError(fnErr); return; }
      const mnErr = validateName("Middle name", middleName, false); if (mnErr) { setError(mnErr); return; }
      if (!isValidEmail(email)) { setError("Please enter a valid email address (e.g. name@example.com)."); return; }
      if (!isAdminCreating && !emailVerified) { setError("Please verify your email address before creating."); return; }
      if (!phoneCharsOnly(contactNumber)) { setError("Contact number must contain only digits, +, -, (, ), and spaces."); return; }
      if (!isValidPhone(contactNumber)) { setError("Contact number must have at least 7 digits."); return; }
      if (isTraineeRole) {
        const schErr = validateInstitution("School", school); if (schErr) { setError(schErr); return; }
        const coErr = validateInstitution("Company name", companyName); if (coErr) { setError(coErr); return; }
      }

      if (isTraineeRole) {
        for (let i = 0; i < supervisors.length; i++) {
          const s = supervisors[i];
          const sLn = validateName(`Supervisor #${i + 1} last name`, s.lastName, true); if (sLn) { setError(sLn); return; }
          const sFn = validateName(`Supervisor #${i + 1} first name`, s.firstName, true); if (sFn) { setError(sFn); return; }
          const sMn = validateName(`Supervisor #${i + 1} middle name`, s.middleName ?? "", false); if (sMn) { setError(sMn); return; }
          if (!s.contactNumber?.trim() && !s.email?.trim()) {
            setError(`Supervisor #${i + 1}: At least one of Contact Number or Email is required.`); return;
          }
        }
      }

      // Check for duplicate supervisors (same full name)
      if (isTraineeRole) {
        const supKeys = new Set<string>();
        for (let i = 0; i < supervisors.length; i++) {
          const s = supervisors[i];
          const key = [s.firstName, s.middleName, s.lastName, s.suffix].map((v) => (v ?? "").trim().toLowerCase()).join("|");
          if (supKeys.has(key)) {
            const dupName = [s.firstName, s.middleName, s.lastName, s.suffix].filter(Boolean).join(" ");
            setError(`Duplicate supervisor: "${dupName}". Each supervisor must be unique per trainee.`);
            return;
          }
          supKeys.add(key);
        }
      }
      setLoading(true);
      try {
        await createTrainee({
          role: showRoleField ? role : defaultRole,
          lastName, firstName, middleName: middleName || undefined, suffix: suffix || undefined,
          email,
          contactNumber,
          school: isTraineeRole ? school : "N/A",
          companyName: isTraineeRole ? companyName : "N/A",
          requiredHours: isTraineeRole ? Number(requiredHours) : 1,
          workSchedule: isTraineeRole && Object.keys(workSchedule).length > 0 ? workSchedule : undefined,
          ...(isAdminCreating ? {} : { password, verificationToken }),
          supervisors: isTraineeRole && supervisors.length > 0 ? supervisors : undefined,
        });
        onCreated();
      } catch (err: unknown) { setError(err instanceof Error ? err.message : "Failed to create trainee."); }
      finally { setLoading(false); }
    });
  };

  const formContent = (
    <div className={isModal ? "card drawer-form-card" : "card"} style={{ margin: isModal ? 0 : "0 auto" }}>
      {showFormHeader && (
        <div className={isModal ? "drawer-form-header" : undefined} style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: isModal ? 0 : "1.25rem" }}>
          <div style={{ width: "2.5rem", height: "2.5rem", borderRadius: "var(--radius-sm)", background: "var(--primary-light)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" /></svg>
          </div>
          <div>
            <h2 style={{ fontSize: "1.15rem", marginBottom: "0.1rem" }}>{title}</h2>
            <p style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>{subtitle}</p>
          </div>
        </div>
      )}

      <form id={formId} onSubmit={handleSubmit} className={isModal ? "drawer-form" : undefined}>
        <div className={isModal ? "drawer-form-body" : undefined}>
          {showRoleField && (
          <div className="form-group">
            <label>Role *</label>
            <select value={role} onChange={(e) => setRole(e.target.value as "admin" | "trainee")}>
              <option value="trainee">Trainee</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          )}

        {/* Name fields */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
          <div className="form-group">
            <label>Last Name *</label>
            <input value={lastName} onChange={(e) => setLastName(sanitizeInput(e.target.value).toUpperCase())} placeholder="DELA CRUZ" style={{ textTransform: "uppercase" }} />
          </div>
          <div className="form-group">
            <label>First Name *</label>
            <input value={firstName} onChange={(e) => setFirstName(sanitizeInput(e.target.value).toUpperCase())} placeholder="JUAN" style={{ textTransform: "uppercase" }} />
          </div>
          <div className="form-group">
            <label>Middle Name</label>
            <input value={middleName} onChange={(e) => setMiddleName(sanitizeInput(e.target.value).toUpperCase())} placeholder="SANTOS" style={{ textTransform: "uppercase" }} />
          </div>
          <div className="form-group">
            <label>Suffix</label>
            <select value={suffix} onChange={(e) => setSuffix(e.target.value)}>
              {SUFFIX_OPTIONS.map((opt) => (<option key={opt} value={opt}>{opt || "N/A"}</option>))}
            </select>
          </div>
        </div>

        {/* Contact fields */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
          <div className="form-group">
            <label>Email * {!isAdminCreating && emailVerified && <span style={{ color: "var(--success-text)", fontSize: "0.8rem" }}>{"\u2713"} Verified</span>}</label>
            <div style={{ display: "flex", gap: "0.35rem" }}>
              <input type="email" value={email} onChange={(e) => handleEmailChange(e.target.value)} placeholder="juan@email.com" style={{ flex: 1, ...(!isAdminCreating && emailVerified ? { borderColor: "var(--success)" } : {}) }} disabled={!isAdminCreating && emailVerified} />
              {!isAdminCreating && !emailVerified && (
                <button type="button" className="btn btn-outline" style={{ fontSize: "0.78rem", padding: "0.3rem 0.6rem", whiteSpace: "nowrap" }} onClick={handleSendVerification} disabled={emailSending}>
                  {emailSending ? "Sending\u2026" : emailCodeSent ? "Resend" : "Verify"}
                </button>
              )}
              {!isAdminCreating && emailVerified && (
                <button type="button" className="btn btn-outline" style={{ fontSize: "0.78rem", padding: "0.3rem 0.6rem", whiteSpace: "nowrap" }} onClick={() => handleEmailChange(email)}>Change</button>
              )}
            </div>
            {!isAdminCreating && emailCodeSent && !emailVerified && (
              <div style={{ display: "flex", gap: "0.35rem", marginTop: "0.35rem" }}>
                <input type="text" inputMode="numeric" maxLength={6} value={emailCode} onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, ""))} placeholder="6-digit code" style={{ flex: 1, letterSpacing: "0.3em", textAlign: "center", fontSize: "1rem" }} />
                <button type="button" className="btn btn-primary" style={{ fontSize: "0.78rem", padding: "0.3rem 0.6rem", whiteSpace: "nowrap" }} onClick={handleVerifyEmailCode} disabled={emailSending}>
                  {emailSending ? "Verifying\u2026" : "Confirm"}
                </button>
              </div>
            )}
            {!isAdminCreating && emailMsg && (
              <span style={{ fontSize: "0.78rem", marginTop: "0.25rem", color: emailVerified ? "var(--success-text)" : "var(--primary)" }}>{emailMsg}</span>
            )}
            {isAdminCreating && (
              <span style={{ fontSize: "0.78rem", marginTop: "0.25rem", color: "var(--text-muted)" }}>A temporary password will be sent to this email.</span>
            )}
          </div>
          <div className="form-group">
            <label>Contact Number *</label>
            <input value={contactNumber} onChange={(e) => setContactNumber(sanitizeInput(e.target.value))} placeholder="09171234567" />
          </div>
        </div>

        {isTraineeRole && (
          <>
            {/* School, Company, Hours */}
            <div className="form-group">
              <label>School *</label>
              <input value={school} onChange={(e) => setSchool(sanitizeInput(e.target.value).toUpperCase())} placeholder="SCHOOL / UNIVERSITY NAME HERE" style={{ textTransform: "uppercase" }} />
            </div>
            <div className="form-group">
              <label>Company / Institution Name *</label>
              <input value={companyName} onChange={(e) => setCompanyName(sanitizeInput(e.target.value).toUpperCase())} placeholder="COMPANY / INSTITUTION WHERE OJT IS RENDERED" style={{ textTransform: "uppercase" }} />
            </div>
            <div className="form-group">
              <label>Required Hours *</label>
              <input type="number" min="1" value={requiredHours} onChange={(e) => setRequiredHours(e.target.value)} />
            </div>

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
                  <TimePicker value={workSchedule[dayNum].start} onChange={(v) => updateDayTime(Number(dayNum), "start", v)} />
                  <TimePicker value={workSchedule[dayNum].end} onChange={(v) => updateDayTime(Number(dayNum), "end", v)} />
                </div>
              ))}
              {Object.keys(workSchedule).length === 0 && (
                <p style={{ color: "var(--danger)", fontSize: "0.82rem", margin: 0 }}>At least one work day is required.</p>
              )}
            </fieldset>
          </>
        )}

        {!isAdminCreating && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
            <div className="form-group">
              <label>Password *</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Set a unique password" />
            </div>
            <div className="form-group">
              <label>Confirm Password *</label>
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Re-enter password"
                style={confirmPassword ? { borderColor: password === confirmPassword ? "var(--success)" : "var(--danger)" } : undefined} />
              {confirmPassword && (
                <span style={{ fontSize: "0.78rem", marginTop: "0.25rem", color: password === confirmPassword ? "var(--success-text)" : "var(--danger)" }}>
                  {password === confirmPassword ? "\u2713 Passwords match" : "\u2717 Passwords do not match"}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Supervisors section */}
        {isTraineeRole && (
        <div style={{ marginTop: "1rem", borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <label style={{ fontWeight: 600, fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
              SUPERVISORS
            </label>
            <button type="button" className="btn btn-outline" style={{ fontSize: "0.8rem", padding: "0.3rem 0.7rem", gap: "0.25rem" }} onClick={addSupervisor}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              Add Supervisor
            </button>
          </div>

          {supervisors.map((s, idx) => (
            <div key={idx} style={{ background: "var(--bg-subtle)", padding: "0.75rem", borderRadius: "var(--radius-sm)", marginBottom: "0.5rem", position: "relative", border: "1px solid var(--border)" }}>
              <button type="button" onClick={() => removeSupervisor(idx)}
                style={{ position: "absolute", top: "0.4rem", right: "0.5rem", background: "none", border: "none", color: "var(--danger)", fontWeight: 700, fontSize: "1rem", cursor: "pointer", lineHeight: 1 }}>
                {"\u00d7"}
              </button>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem" }}>
                <div className="form-group" style={{ marginBottom: "0.4rem" }}>
                  <label>Last Name *</label>
                  <input value={s.lastName} onChange={(e) => updateSupervisor(idx, "lastName", sanitizeInput(e.target.value).toUpperCase())} style={{ textTransform: "uppercase" }} />
                </div>
                <div className="form-group" style={{ marginBottom: "0.4rem" }}>
                  <label>First Name *</label>
                  <input value={s.firstName} onChange={(e) => updateSupervisor(idx, "firstName", sanitizeInput(e.target.value).toUpperCase())} style={{ textTransform: "uppercase" }} />
                </div>
                <div className="form-group" style={{ marginBottom: "0.4rem" }}>
                  <label>Middle Name</label>
                  <input value={s.middleName ?? ""} onChange={(e) => updateSupervisor(idx, "middleName", sanitizeInput(e.target.value).toUpperCase())} style={{ textTransform: "uppercase" }} />
                </div>
                <div className="form-group" style={{ marginBottom: "0.4rem" }}>
                  <label>Suffix</label>
                  <select value={s.suffix ?? ""} onChange={(e) => updateSupervisor(idx, "suffix", e.target.value)}>
                    {SUFFIX_OPTIONS.map((opt) => (<option key={opt} value={opt}>{opt || "N/A"}</option>))}
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
        )}

          {/* Error */}
          {error && !showSubmitActions && (
            <div style={{ padding: "0.6rem 0.85rem", borderRadius: "var(--radius-sm)", background: "var(--danger-light)", border: "1px solid var(--danger)", color: "var(--danger)", fontSize: "0.85rem", marginBottom: "0.75rem", marginTop: "0.5rem", display: "flex", alignItems: "flex-start", gap: "0.4rem" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: "0.1rem" }}><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
              {error}
            </div>
          )}
        </div>

        {/* Actions */}
        {showSubmitActions && (
          <div className={isModal ? "drawer-form-footer" : undefined}>
            {error && (
              <div style={{ padding: "0.6rem 0.85rem", borderRadius: "var(--radius-sm)", background: "var(--danger-light)", border: "1px solid var(--danger)", color: "var(--danger)", fontSize: "0.85rem", marginBottom: "0.75rem", display: "flex", alignItems: "flex-start", gap: "0.4rem" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: "0.1rem" }}><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
                {error}
              </div>
            )}

            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              {onClose && (
                <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
              )}
              <button type="submit" className="btn btn-primary" disabled={loading} style={{ gap: "0.35rem" }}>
                {loading ? "Creating\u2026" : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                    {submitLabel}
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  );

  if (!isModal) {
    return formContent;
  }

  return (
    <RightSidebarDrawer onClose={onClose ?? (() => {})} width={620}>
      {formContent}
    </RightSidebarDrawer>
  );
}