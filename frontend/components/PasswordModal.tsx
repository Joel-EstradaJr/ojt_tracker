"use client";

// ============================================================
// PasswordModal — prompts user for the trainee-specific password.
// On success, navigates to the trainee's dashboard page.
// Forgot-password flow: send code → verify code → reset password
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
}

type Step = "login" | "codeSent" | "newPassword";

export default function PasswordModal({ traineeId, onClose }: Props) {
  const router = useRouter();

  // shared
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  // login step
  const [password, setPassword] = useState("");

  // forgot-password multi-step
  const [step, setStep] = useState<Step>("login");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  /* ---- helpers ---- */
  const resetAll = () => {
    setStep("login");
    setError("");
    setSuccessMsg("");
    setPassword("");
    setMaskedEmail("");
    setResetCode("");
    setResetToken("");
    setNewPassword("");
    setConfirmPassword("");
  };

  /* ---- Step: login ---- */
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await verifyPassword(traineeId, password);
      router.push(`/trainee/${traineeId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Incorrect password.");
    } finally {
      setLoading(false);
    }
  };

  /* ---- Click "Forgot password?" → send code ---- */
  const handleForgotClick = async () => {
    setError("");
    setLoading(true);
    try {
      const res = await forgotPassword(traineeId);
      setMaskedEmail(res.maskedEmail);
      setStep("codeSent");
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to send reset code."
      );
    } finally {
      setLoading(false);
    }
  };

  /* ---- Step: codeSent → verify code ---- */
  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (resetCode.length !== 6) {
      setError("Please enter the 6-digit code.");
      return;
    }
    setLoading(true);
    try {
      const res = await verifyResetCode(traineeId, resetCode);
      setResetToken(res.resetToken);
      setStep("newPassword");
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Invalid or expired code."
      );
    } finally {
      setLoading(false);
    }
  };

  /* ---- Step: newPassword → reset ---- */
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (newPassword.length < 4) {
      setError("New password must be at least 4 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const res = await resetPassword(traineeId, newPassword, resetToken);
      setSuccessMsg(res.message);
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => resetAll(), 1500);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to reset password."
      );
    } finally {
      setLoading(false);
    }
  };

  /* ---- Render ---- */
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>

        {/* ===== LOGIN STEP ===== */}
        {step === "login" && (
          <>
            <h2 style={{ marginBottom: "1rem" }}>Enter Password</h2>
            <form onSubmit={handleLogin}>
              <div className="form-group">
                <label htmlFor="pwd">Trainee Password</label>
                <input
                  id="pwd"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoFocus
                />
              </div>

              {error && (
                <p style={{ color: "var(--danger)", marginBottom: "0.75rem", fontSize: "0.85rem" }}>
                  {error}
                </p>
              )}

              <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", alignItems: "center" }}>
                <button
                  type="button"
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--primary)",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                    textDecoration: "underline",
                    marginRight: "auto",
                  }}
                  onClick={handleForgotClick}
                  disabled={loading}
                >
                  {loading ? "Sending code…" : "Forgot password?"}
                </button>
                <button type="button" className="btn btn-outline" onClick={onClose}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={loading}>
                  {loading ? "Checking…" : "Unlock"}
                </button>
              </div>
            </form>
          </>
        )}

        {/* ===== CODE SENT STEP ===== */}
        {step === "codeSent" && (
          <>
            <h2 style={{ marginBottom: "0.5rem" }}>Verify Your Email</h2>
            <p style={{ fontSize: "0.9rem", color: "#666", marginBottom: "1rem" }}>
              A 6-digit code was sent to <strong>{maskedEmail}</strong>. It expires in 10 minutes.
            </p>
            <form onSubmit={handleVerifyCode}>
              <div className="form-group">
                <label htmlFor="resetCode">Verification Code</label>
                <input
                  id="resetCode"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={resetCode}
                  onChange={(e) => setResetCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  autoFocus
                  style={{ letterSpacing: "0.5em", fontSize: "1.25rem", textAlign: "center" }}
                />
              </div>

              {error && (
                <p style={{ color: "var(--danger)", marginBottom: "0.75rem", fontSize: "0.85rem" }}>
                  {error}
                </p>
              )}

              <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", alignItems: "center" }}>
                <button
                  type="button"
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--primary)",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                    textDecoration: "underline",
                    marginRight: "auto",
                  }}
                  onClick={handleForgotClick}
                  disabled={loading}
                >
                  {loading ? "Resending…" : "Resend code"}
                </button>
                <button type="button" className="btn btn-outline" onClick={resetAll}>
                  Back
                </button>
                <button type="submit" className="btn btn-primary" disabled={loading}>
                  {loading ? "Verifying…" : "Verify Code"}
                </button>
              </div>
            </form>
          </>
        )}

        {/* ===== NEW PASSWORD STEP ===== */}
        {step === "newPassword" && (
          <>
            <h2 style={{ marginBottom: "1rem" }}>Set New Password</h2>
            <form onSubmit={handleResetPassword}>
              <div className="form-group">
                <label htmlFor="newPwd">New Password</label>
                <input
                  id="newPwd"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min 4 characters"
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label htmlFor="confirmPwd">Confirm Password</label>
                <input
                  id="confirmPwd"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  style={confirmPassword ? { borderColor: newPassword === confirmPassword ? "#16a34a" : "var(--danger)" } : undefined}
                />
                {confirmPassword && (
                  <span style={{ fontSize: "0.78rem", marginTop: "0.25rem", color: newPassword === confirmPassword ? "#16a34a" : "var(--danger)" }}>
                    {newPassword === confirmPassword ? "✓ Passwords match" : "✗ Passwords do not match"}
                  </span>
                )}
              </div>

              {error && (
                <p style={{ color: "var(--danger)", marginBottom: "0.75rem", fontSize: "0.85rem" }}>
                  {error}
                </p>
              )}
              {successMsg && (
                <p style={{ color: "var(--success, #22c55e)", marginBottom: "0.75rem", fontSize: "0.85rem" }}>
                  {successMsg}
                </p>
              )}

              <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                <button type="button" className="btn btn-outline" onClick={resetAll}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={loading}>
                  {loading ? "Resetting…" : "Reset Password"}
                </button>
              </div>
            </form>
          </>
        )}

      </div>
    </div>
  );
}
