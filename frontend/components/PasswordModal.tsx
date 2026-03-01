"use client";

// ============================================================
// PasswordModal
// ============================================================

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  verifyPassword,
  resetPassword,
  forgotPassword,
  verifyResetCode,
} from "@/lib/api";

interface Props {
  traineeId: string;
  onClose: () => void;
  /** Called after a successful login; if provided, replaces the default router.push */
  onAuthenticated?: () => void;
}

type Step = "login" | "codeSent" | "newPassword";

export default function PasswordModal({ traineeId, onClose, onAuthenticated }: Props) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<Step>("login");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const resetAll = () => {
    setStep("login"); setError(""); setSuccessMsg(""); setPassword("");
    setMaskedEmail(""); setResetCode(""); setResetToken(""); setNewPassword(""); setConfirmPassword("");
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault(); setError(""); setLoading(true);
    try {
      await verifyPassword(traineeId, password);
      if (onAuthenticated) onAuthenticated();
      else router.push(`/trainee/${traineeId}`);
    }
    catch (err: unknown) { setError(err instanceof Error ? err.message : "Incorrect password."); }
    finally { setLoading(false); }
  };

  const handleForgotClick = async () => {
    setError(""); setLoading(true);
    try { const res = await forgotPassword(traineeId); setMaskedEmail(res.maskedEmail); setStep("codeSent"); }
    catch (err: unknown) { setError(err instanceof Error ? err.message : "Failed to send reset code."); }
    finally { setLoading(false); }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault(); setError("");
    if (resetCode.length !== 6) { setError("Please enter the 6-digit code."); return; }
    setLoading(true);
    try { const res = await verifyResetCode(traineeId, resetCode); setResetToken(res.resetToken); setStep("newPassword"); }
    catch (err: unknown) { setError(err instanceof Error ? err.message : "Invalid or expired code."); }
    finally { setLoading(false); }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault(); setError("");
    if (newPassword.length < 4) { setError("New password must be at least 4 characters."); return; }
    if (newPassword !== confirmPassword) { setError("Passwords do not match."); return; }
    setLoading(true);
    try {
      const res = await resetPassword(traineeId, newPassword, resetToken);
      setSuccessMsg(res.message); setNewPassword(""); setConfirmPassword("");
      setTimeout(() => resetAll(), 1500);
    } catch (err: unknown) { setError(err instanceof Error ? err.message : "Failed to reset password."); }
    finally { setLoading(false); }
  };

  const ErrorBox = ({ msg }: { msg: string }) => (
    <div style={{ padding: "0.5rem 0.75rem", borderRadius: "var(--radius-sm)", background: "var(--danger-light)", border: "1px solid var(--danger)", color: "var(--danger)", fontSize: "0.84rem", marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.35rem" }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
      {msg}
    </div>
  );

  const IconHeader = ({ bg, iconColor, icon, title, subtitle }: { bg: string; iconColor: string; icon: React.ReactNode; title: string; subtitle: string }) => (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.15rem" }}>
      <div style={{ width: "2.5rem", height: "2.5rem", borderRadius: "var(--radius-sm)", background: bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: iconColor }}>{icon}</div>
      <div>
        <h2 style={{ fontSize: "1.15rem", marginBottom: "0.1rem" }}>{title}</h2>
        <p style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>{subtitle}</p>
      </div>
    </div>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>

        {step === "login" && (
          <>
            <IconHeader bg="var(--primary-light)" iconColor="var(--primary)" icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>} title="Enter Password" subtitle="Unlock to view trainee dashboard" />
            <form onSubmit={handleLogin}>
              <div className="form-group">
                <label htmlFor="pwd">Trainee Password</label>
                <input id="pwd" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter password" autoFocus />
              </div>
              {error && <ErrorBox msg={error} />}
              <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", alignItems: "center" }}>
                <button type="button" className="btn btn-ghost" style={{ marginRight: "auto", fontSize: "0.84rem" }} onClick={handleForgotClick} disabled={loading}>{loading ? "Sending code\u2026" : "Forgot password?"}</button>
                <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? "Checking\u2026" : "Unlock"}</button>
              </div>
            </form>
          </>
        )}

        {step === "codeSent" && (
          <>
            <IconHeader bg="var(--info-light)" iconColor="var(--info)" icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>} title="Verify Your Email" subtitle={`Code sent to ${maskedEmail}. Expires in 10 min.`} />
            <form onSubmit={handleVerifyCode}>
              <div className="form-group">
                <label htmlFor="resetCode">Verification Code</label>
                <input id="resetCode" type="text" inputMode="numeric" maxLength={6} value={resetCode} onChange={(e) => setResetCode(e.target.value.replace(/\D/g, ""))} placeholder="000000" autoFocus style={{ letterSpacing: "0.5em", fontSize: "1.25rem", textAlign: "center", fontWeight: 600 }} />
              </div>
              {error && <ErrorBox msg={error} />}
              <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", alignItems: "center" }}>
                <button type="button" className="btn btn-ghost" style={{ marginRight: "auto", fontSize: "0.84rem" }} onClick={handleForgotClick} disabled={loading}>{loading ? "Resending\u2026" : "Resend code"}</button>
                <button type="button" className="btn btn-outline" onClick={resetAll}>Back</button>
                <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? "Verifying\u2026" : "Verify Code"}</button>
              </div>
            </form>
          </>
        )}

        {step === "newPassword" && (
          <>
            <IconHeader bg="var(--success-light)" iconColor="var(--success)" icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>} title="Set New Password" subtitle="Choose a strong password." />
            <form onSubmit={handleResetPassword}>
              <div className="form-group">
                <label htmlFor="newPwd">New Password</label>
                <input id="newPwd" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Min 4 characters" autoFocus />
              </div>
              <div className="form-group">
                <label htmlFor="confirmPwd">Confirm Password</label>
                <input id="confirmPwd" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Re-enter new password" style={confirmPassword ? { borderColor: newPassword === confirmPassword ? "var(--success)" : "var(--danger)" } : undefined} />
                {confirmPassword && (
                  <span style={{ fontSize: "0.78rem", marginTop: "0.25rem", color: newPassword === confirmPassword ? "var(--success-text)" : "var(--danger)", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                    {newPassword === confirmPassword ? "\u2713 Passwords match" : "\u2717 Passwords do not match"}
                  </span>
                )}
              </div>
              {error && <ErrorBox msg={error} />}
              {successMsg && (
                <div style={{ padding: "0.5rem 0.75rem", borderRadius: "var(--radius-sm)", background: "var(--success-light)", border: "1px solid var(--success)", color: "var(--success-text)", fontSize: "0.84rem", marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.35rem" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  {successMsg}
                </div>
              )}
              <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                <button type="button" className="btn btn-outline" onClick={resetAll}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? "Resetting\u2026" : "Reset Password"}</button>
              </div>
            </form>
          </>
        )}

      </div>
    </div>
  );
}