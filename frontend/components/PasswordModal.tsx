"use client";

// ============================================================
// PasswordModal — prompts user for the trainee-specific password.
// On success, navigates to the trainee's dashboard page.
// ============================================================

import { useState } from "react";
import { useRouter } from "next/navigation";
import { verifyPassword, resetPassword } from "@/lib/api";

interface Props {
  traineeId: string;
  onClose: () => void;
}

export default function PasswordModal({ traineeId, onClose }: Props) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetMsg, setResetMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await verifyPassword(traineeId, password);
      // Password correct — navigate to the trainee dashboard
      router.push(`/trainee/${traineeId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Incorrect password.");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setResetMsg("");

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
      const result = await resetPassword(traineeId, newPassword);
      setResetMsg(result.message);
      setNewPassword("");
      setConfirmPassword("");
      // Switch back to login view after a short delay
      setTimeout(() => {
        setResetting(false);
        setResetMsg("");
      }, 1500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to reset password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        {!resetting ? (
          <>
            <h2 style={{ marginBottom: "1rem" }}>Enter Password</h2>

            <form onSubmit={handleSubmit}>
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

              {error && <p style={{ color: "var(--danger)", marginBottom: "0.75rem", fontSize: "0.85rem" }}>{error}</p>}

              <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", alignItems: "center" }}>
                <button
                  type="button"
                  style={{ background: "none", border: "none", color: "var(--primary)", cursor: "pointer", fontSize: "0.85rem", textDecoration: "underline", marginRight: "auto" }}
                  onClick={() => { setResetting(true); setError(""); }}
                >
                  Forgot password?
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
        ) : (
          <>
            <h2 style={{ marginBottom: "1rem" }}>Reset Password</h2>

            <form onSubmit={handleReset}>
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
                />
              </div>

              {error && <p style={{ color: "var(--danger)", marginBottom: "0.75rem", fontSize: "0.85rem" }}>{error}</p>}
              {resetMsg && <p style={{ color: "var(--success, #22c55e)", marginBottom: "0.75rem", fontSize: "0.85rem" }}>{resetMsg}</p>}

              <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                <button type="button" className="btn btn-outline" onClick={() => { setResetting(false); setError(""); setResetMsg(""); }}>
                  Back
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
