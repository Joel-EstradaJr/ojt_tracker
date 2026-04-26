"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import CreateTraineeForm from "@/components/CreateTraineeForm";
import RightSidebarDrawer from "@/components/RightSidebarDrawer";
import FaceCaptureDialog from "@/components/FaceCaptureDialog";
import { ThemeToggle } from "@/components/ThemeProvider";
import {
  enrollFace,
  fetchFaceConfig,
  faceLogin,
  getSession,
  isLoginError,
  login,
  logout,
  setInitialPassword,
  requestForgotPasswordCode,
  verifyPendingEmailChange,
  verifyForgotPasswordCode,
  resetForgottenPassword,
} from "@/lib/api";

type ForgotStep = "request" | "verify" | "reset";

type LockoutState = {
  lockoutUserId: string;
  lockoutEndsAtMs: number;
  failedAttempts: number;
  attemptsRemaining: number;
};

type PermanentLockState = {
  lockoutUserId: string;
  failedAttempts: number;
  attemptsRemaining: number;
};

export default function LoginPage() {
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const [showFaceLogin, setShowFaceLogin] = useState(false);
  const [faceLoginLoading, setFaceLoginLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [showSignUp, setShowSignUp] = useState(false);
  const [error, setError] = useState("");
  const [activeLockout, setActiveLockout] = useState<LockoutState | null>(null);
  const [permanentLock, setPermanentLock] = useState<PermanentLockState | null>(null);
  const [signupSuccess, setSignupSuccess] = useState("");
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotStep, setForgotStep] = useState<ForgotStep>("request");
  const [forgotFullName, setForgotFullName] = useState("");
  const [forgotCode, setForgotCode] = useState("");
  const [forgotResetToken, setForgotResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [forgotMaskedEmail, setForgotMaskedEmail] = useState<string | null>(null);
  const [forgotMessage, setForgotMessage] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const lockoutTimerRef = useRef<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Forced password change (admin-created account)
  const [showSetPassword, setShowSetPassword] = useState(false);
  const [setPasswordTraineeId, setSetPasswordTraineeId] = useState("");
  const [setPasswordTempPwd, setSetPasswordTempPwd] = useState(""); // the password the user typed at login
  const [setNewPwd, setSetNewPwd] = useState("");
  const [setConfirmPwd, setSetConfirmPwd] = useState("");
  const [setPasswordLoading, setSetPasswordLoading] = useState(false);
  const [showPendingEmailVerify, setShowPendingEmailVerify] = useState(false);
  const [pendingTraineeId, setPendingTraineeId] = useState("");
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [pendingEmailExpiresAt, setPendingEmailExpiresAt] = useState<string | null>(null);
  const [pendingCode, setPendingCode] = useState("");
  const [pendingAttemptsRemaining, setPendingAttemptsRemaining] = useState<number>(3);
  const [pendingAdminResendRequired, setPendingAdminResendRequired] = useState(false);
  const [pendingVerifyLoading, setPendingVerifyLoading] = useState(false);
  const [pendingVerifyError, setPendingVerifyError] = useState("");
  const [showMandatoryFaceEnroll, setShowMandatoryFaceEnroll] = useState(false);
  const [mandatoryFaceEnrollLoading, setMandatoryFaceEnrollLoading] = useState(false);
  const [mandatoryFaceServiceReachable, setMandatoryFaceServiceReachable] = useState(true);
  const [mandatoryFaceError, setMandatoryFaceError] = useState("");

  const GENERIC_LOGIN_ERROR = "Invalid credentials. Please try again.";

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs === 0 ? `${mins}m` : `${mins}m ${secs}s`;
  };

  const getAttemptsSummary = (failedAttempts: number, attemptsRemaining: number) => {
    return `Attempts: ${failedAttempts}/15 (${attemptsRemaining} remaining).`;
  };

  const activeLockoutRemainingSeconds = activeLockout
    ? Math.max(0, Math.ceil((activeLockout.lockoutEndsAtMs - nowMs) / 1000))
    : 0;

  const lockoutMessage = activeLockout
    ? `Invalid credentials. Locked for ${formatDuration(activeLockoutRemainingSeconds)}.`
    : "";

  const permanentLockMessage = permanentLock
    ? `Invalid credentials. Account locked. Use Forgot password.`
    : "";

  const displayError = lockoutMessage || permanentLockMessage || error;
  const isLoginRestricted = Boolean(activeLockout || permanentLock);
  const isLoginButtonDisabled = loading || isLoginRestricted;

  useEffect(() => {
    if (!activeLockout || activeLockoutRemainingSeconds <= 0) {
      if (activeLockout && activeLockoutRemainingSeconds <= 0) {
        setActiveLockout(null);
      }
      if (lockoutTimerRef.current !== null) {
        window.clearInterval(lockoutTimerRef.current);
        lockoutTimerRef.current = null;
      }
      return;
    }

    if (lockoutTimerRef.current === null) {
      lockoutTimerRef.current = window.setInterval(() => {
        setNowMs(Date.now());
      }, 1000);
    }

    return () => {
      if (lockoutTimerRef.current !== null) {
        window.clearInterval(lockoutTimerRef.current);
        lockoutTimerRef.current = null;
      }
    };
  }, [activeLockout, activeLockoutRemainingSeconds]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const session = await getSession();
        if (cancelled || !session.authenticated) return;

        if (session.role === "admin") {
          router.replace("/admin/trainee-management");
          return;
        }

        if (session.role === "trainee" && session.traineeId) {
          if (session.requiresFaceEnrollment) {
            setPendingTraineeId(session.traineeId);
            setMandatoryFaceError("");
            setShowMandatoryFaceEnroll(true);
            return;
          }

          if (session.requiresPendingEmailVerification) {
            setPendingTraineeId(session.traineeId);
            setPendingEmail(session.pendingEmail ?? null);
            setPendingEmailExpiresAt(session.pendingEmailExpiresAt ?? null);
            setPendingAttemptsRemaining(typeof session.pendingEmailAttemptsRemaining === "number" ? session.pendingEmailAttemptsRemaining : 3);
            setPendingAdminResendRequired(Boolean(session.pendingEmailAdminResendRequired));
            setPendingVerifyError("");
            setShowPendingEmailVerify(true);
            return;
          }
          router.replace(`/trainee/${session.traineeId}`);
        }
      } catch {
        // no active session
      } finally {
        if (!cancelled) setCheckingSession(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!showMandatoryFaceEnroll) return;

    let cancelled = false;
    (async () => {
      try {
        const cfg = await fetchFaceConfig();
        if (!cancelled) setMandatoryFaceServiceReachable(Boolean(cfg.faceServiceConfigured) && Boolean(cfg.faceServiceReachable));
      } catch {
        if (!cancelled) setMandatoryFaceServiceReachable(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [showMandatoryFaceEnroll]);

  const handleLogin = async () => {
    if (isLoginRestricted) {
      return;
    }

    setError("");
    setSignupSuccess("");
    setForgotMessage("");

    const normalizedFullName = fullName.trim().toUpperCase();

    if (!normalizedFullName) {
      setError("Full Name is required.");
      return;
    }

    if (normalizedFullName.split(/\s+/).length < 2) {
      setError("Full Name must include at least first name and last name.");
      return;
    }

    if (!password.trim()) {
      setError("Password is required.");
      return;
    }

    setLoading(true);
    try {
      const result = await login(normalizedFullName, password);
      setActiveLockout(null);
      setPermanentLock(null);

      // Check if the user must set a new password (admin-created account)
      if (result.mustChangePassword && result.traineeId) {
        setShowSetPassword(true);
        setSetPasswordTraineeId(result.traineeId);
        setSetPasswordTempPwd(password);
        setShowSignUp(false);
        setShowForgotPassword(false);
        setError("");
        return;
      }

      if (result.role === "admin") {
        router.replace("/admin/trainee-management");
      } else if (result.traineeId) {
        if (result.requiresFaceEnrollment) {
          setPendingTraineeId(result.traineeId);
          setMandatoryFaceError("");
          setShowMandatoryFaceEnroll(true);
          return;
        }

        if (result.requiresPendingEmailVerification) {
          setPendingTraineeId(result.traineeId);
          setPendingEmail(result.pendingEmail ?? null);
          setPendingEmailExpiresAt(result.pendingEmailExpiresAt ?? null);
          setPendingAttemptsRemaining(typeof result.pendingEmailAttemptsRemaining === "number" ? result.pendingEmailAttemptsRemaining : 3);
          setPendingAdminResendRequired(Boolean(result.pendingEmailAdminResendRequired));
          setPendingCode("");
          setPendingVerifyError("");
          setShowPendingEmailVerify(true);
          return;
        }
        router.replace(`/trainee/${result.traineeId}`);
      } else {
        router.replace("/login");
      }
    } catch (err: unknown) {
      if (isLoginError(err)) {
        const failedAttempts = typeof err.details.failedAttempts === "number" ? err.details.failedAttempts : 0;
        const attemptsRemaining = typeof err.details.attemptsRemainingBeforeLock === "number"
          ? err.details.attemptsRemainingBeforeLock
          : Math.max(0, 15 - failedAttempts);
        const lockoutUserId = err.details.lockoutUserId;

        if (err.details.accountLocked && lockoutUserId) {
          setActiveLockout(null);
          setPermanentLock({ lockoutUserId, failedAttempts, attemptsRemaining });
          setError("");
        } else if (err.details.cooldown && typeof err.details.retryAfterSeconds === "number" && lockoutUserId) {
          setPermanentLock(null);
          const fallbackLockoutEndsAt = Date.now() + Math.max(1, Math.ceil(err.details.retryAfterSeconds)) * 1000;
          const parsedLockoutEndsAt = err.details.lockoutEndsAt ? Date.parse(err.details.lockoutEndsAt) : NaN;
          setActiveLockout({
            lockoutUserId,
            lockoutEndsAtMs: Number.isFinite(parsedLockoutEndsAt) ? parsedLockoutEndsAt : fallbackLockoutEndsAt,
            failedAttempts,
            attemptsRemaining,
          });
          setNowMs(Date.now());
          setError("");
        } else {
          setActiveLockout(null);
          setPermanentLock(null);
          setError(`Invalid credentials.`);
        }

        return;
      }

      setActiveLockout(null);
      setPermanentLock(null);
      setError(GENERIC_LOGIN_ERROR);
    } finally {
      setLoading(false);
    }
  };

  const startFaceLogin = () => {
    if (isLoginRestricted) return;

    setError("");
    setSignupSuccess("");
    setForgotMessage("");

    const normalizedFullName = fullName.trim().toUpperCase();
    if (!normalizedFullName) {
      setError("Full Name is required.");
      return;
    }

    if (normalizedFullName.split(/\s+/).length < 2) {
      setError("Full Name must include at least first name and last name.");
      return;
    }

    setShowFaceLogin(true);
  };

  const handleFaceLogin = async (imageDataUrl: string) => {
    if (isLoginRestricted) return;

    setError("");
    setFaceLoginLoading(true);

    const normalizedFullName = fullName.trim().toUpperCase();

    try {
      const result = await faceLogin(normalizedFullName, imageDataUrl);
      setActiveLockout(null);
      setPermanentLock(null);

      if (result.role === "admin") {
        router.replace("/admin/trainee-management");
        return;
      }

      if (result.traineeId) {
        if (result.requiresPendingEmailVerification) {
          setPendingTraineeId(result.traineeId);
          setPendingEmail(result.pendingEmail ?? null);
          setPendingEmailExpiresAt(result.pendingEmailExpiresAt ?? null);
          setPendingAttemptsRemaining(typeof result.pendingEmailAttemptsRemaining === "number" ? result.pendingEmailAttemptsRemaining : 3);
          setPendingAdminResendRequired(Boolean(result.pendingEmailAdminResendRequired));
          setPendingCode("");
          setPendingVerifyError("");
          setShowPendingEmailVerify(true);
          return;
        }
        router.replace(`/trainee/${result.traineeId}`);
        return;
      }

      router.replace("/login");
    } catch (err: unknown) {
      setActiveLockout(null);
      setPermanentLock(null);
      setError(err instanceof Error ? err.message : GENERIC_LOGIN_ERROR);
    } finally {
      setFaceLoginLoading(false);
      setShowFaceLogin(false);
    }
  };

  const openForgotPassword = () => {
    setShowSignUp(false);
    setShowForgotPassword(true);
    setActiveLockout(null);
    setPermanentLock(null);
    setForgotStep("request");
    setForgotCode("");
    setForgotResetToken("");
    setForgotMaskedEmail(null);
    setForgotMessage("");
    setForgotFullName(fullName.trim().toUpperCase());
    setNewPassword("");
    setConfirmPassword("");
    setError("");
  };

  const closeForgotPassword = () => {
    setShowForgotPassword(false);
    setActiveLockout(null);
    setPermanentLock(null);
    setForgotStep("request");
    setForgotCode("");
    setForgotResetToken("");
    setForgotMaskedEmail(null);
    setForgotMessage("");
    setNewPassword("");
    setConfirmPassword("");
    setForgotLoading(false);
    setError("");
  };

  const handleRequestResetCode = async () => {
    const normalizedName = forgotFullName.trim().toUpperCase();
    setError("");
    setForgotMessage("");

    if (!normalizedName) {
      setError("Full Name is required.");
      return;
    }

    if (normalizedName.split(/\s+/).length < 2) {
      setError("Full Name must include at least first name and last name.");
      return;
    }

    setForgotLoading(true);
    try {
      const result = await requestForgotPasswordCode(normalizedName);
      setForgotMaskedEmail(result.maskedEmail ?? null);
      setForgotMessage(result.message);
      setForgotStep("verify");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to send verification code.");
    } finally {
      setForgotLoading(false);
    }
  };

  const handleVerifyResetCode = async () => {
    const normalizedName = forgotFullName.trim().toUpperCase();
    setError("");

    if (forgotCode.length !== 6) {
      setError("Please enter the 6-digit verification code.");
      return;
    }

    setForgotLoading(true);
    try {
      const result = await verifyForgotPasswordCode(normalizedName, forgotCode);
      setForgotResetToken(result.resetToken);
      setForgotStep("reset");
      setForgotMessage("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invalid or expired verification code. Please enter the latest code or resend a new one.");
    } finally {
      setForgotLoading(false);
    }
  };

  const handleResendResetCode = async () => {
    const normalizedName = forgotFullName.trim().toUpperCase();
    setError("");
    setForgotMessage("");

    if (!normalizedName) {
      setError("Full Name is required.");
      return;
    }

    if (normalizedName.split(/\s+/).length < 2) {
      setError("Full Name must include at least first name and last name.");
      return;
    }

    setForgotLoading(true);
    try {
      const result = await requestForgotPasswordCode(normalizedName);
      setForgotCode("");
      setForgotResetToken("");
      setForgotMaskedEmail(result.maskedEmail ?? null);
      setForgotMessage("A new verification code was sent. Previous codes are now invalid.");
      setForgotStep("verify");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to resend verification code.");
    } finally {
      setForgotLoading(false);
    }
  };

  const handleResetForgottenPassword = async () => {
    const normalizedName = forgotFullName.trim().toUpperCase();
    setError("");

    if (newPassword.length < 4) {
      setError("New password must be at least 4 characters.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (!forgotResetToken) {
      setError("Reset token is missing. Please verify your code again.");
      setForgotStep("verify");
      return;
    }

    setForgotLoading(true);
    try {
      const result = await resetForgottenPassword(normalizedName, newPassword, confirmPassword, forgotResetToken);
      setForgotMessage(result.message);
      setShowForgotPassword(false);
      setForgotStep("request");
      setForgotCode("");
      setForgotResetToken("");
      setNewPassword("");
      setConfirmPassword("");
      setActiveLockout(null);
      setPermanentLock(null);
      setError("");
      setSignupSuccess("Password updated. You can now log in with your new password.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to reset password.");
    } finally {
      setForgotLoading(false);
    }
  };

  const handleSetInitialPassword = async () => {
    setError("");

    if (setNewPwd.length < 4) {
      setError("New password must be at least 4 characters.");
      return;
    }

    if (setNewPwd !== setConfirmPwd) {
      setError("Passwords do not match.");
      return;
    }

    setSetPasswordLoading(true);
    try {
      const result = await setInitialPassword(setPasswordTraineeId, setPasswordTempPwd, setNewPwd, setConfirmPwd);
      setShowSetPassword(false);
      setSetNewPwd("");
      setSetConfirmPwd("");
      setSetPasswordTempPwd("");
      setError("");

      if (result.role === "admin") {
        router.replace("/admin/trainee-management");
      } else if (result.traineeId) {
        if (result.requiresFaceEnrollment) {
          setPendingTraineeId(result.traineeId);
          setMandatoryFaceError("");
          setShowMandatoryFaceEnroll(true);
          return;
        }
        router.replace(`/trainee/${result.traineeId}`);
      } else {
        setSignupSuccess("Password set successfully. You can now log in.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to set password.");
    } finally {
      setSetPasswordLoading(false);
    }
  };

  const handleVerifyPendingEmail = async () => {
    setPendingVerifyError("");
    if (!pendingTraineeId) {
      setPendingVerifyError("Session is missing. Please login again.");
      return;
    }
    if (!pendingCode.trim()) {
      setPendingVerifyError("Verification code is required.");
      return;
    }
    if (pendingAdminResendRequired) {
      setPendingVerifyError("Maximum attempts reached. Ask your admin to resend a new verification code.");
      return;
    }

    setPendingVerifyLoading(true);
    try {
      await verifyPendingEmailChange(pendingTraineeId, pendingCode.trim());
      setShowPendingEmailVerify(false);
      setPendingCode("");
      router.replace(`/trainee/${pendingTraineeId}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to verify email change.";
      setPendingVerifyError(message);

      const lower = message.toLowerCase();
      if (lower.includes("maximum verification attempts") || lower.includes("admin to resend")) {
        setPendingAdminResendRequired(true);
        setPendingAttemptsRemaining(0);
      } else {
        setPendingAttemptsRemaining((prev) => Math.max(0, prev - 1));
      }
    } finally {
      setPendingVerifyLoading(false);
    }
  };

  const handlePendingLogout = async () => {
    try {
      await logout();
    } catch {
      // ignore
    }
    setShowPendingEmailVerify(false);
    setPendingCode("");
    setPendingTraineeId("");
    setPendingEmail(null);
    setPendingEmailExpiresAt(null);
    setPendingAttemptsRemaining(3);
    setPendingAdminResendRequired(false);
    setPendingVerifyError("");
    router.replace("/login");
  };

  const handleMandatoryFaceEnroll = async (imageDataUrl: string) => {
    if (!pendingTraineeId) {
      setMandatoryFaceError("Session is missing. Please log in again.");
      return;
    }

    setMandatoryFaceEnrollLoading(true);
    setMandatoryFaceError("");
    try {
      await enrollFace(imageDataUrl);
      setShowMandatoryFaceEnroll(false);
      router.replace(`/trainee/${pendingTraineeId}`);
    } catch (err: unknown) {
      setMandatoryFaceError(err instanceof Error ? err.message : "Face enrollment failed. Please try again.");
    } finally {
      setMandatoryFaceEnrollLoading(false);
    }
  };

  const handleMandatoryFaceLogout = async () => {
    try {
      await logout();
    } catch {
      // ignore
    }
    setShowMandatoryFaceEnroll(false);
    setPendingTraineeId("");
    setMandatoryFaceError("");
    router.replace("/login");
  };

  if (checkingSession) {
    return (
      <div className="container">
        <div className="skeleton">
          <div className="skeleton-card" style={{ height: "180px", maxWidth: 560, margin: "0 auto" }}>
            <div className="skeleton-line medium" />
            <div className="skeleton-line short" />
            <div className="skeleton-line" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <section className="auth-visual" aria-hidden="true">
        <div className="auth-visual-overlay" />
      </section>

      <section className="auth-panel-wrap">
        <div className="auth-panel">
          <div className={`auth-panel-inner ${showSignUp ? "is-signup" : "is-centered"}`}>
            <div className="auth-panel-header">
              <div>
                <h2>{showSignUp ? "Create Account" : showForgotPassword ? "Forgot Password" : showSetPassword ? "Set Your Password" : "Welcome to OJT Progress Tracker"}</h2>
                <p>
                  {showSignUp
                    ? "Register an account to access daily OJT tracking."
                    : showForgotPassword
                      ? "Recover access using your registered full name and email verification code."
                      : showSetPassword
                        ? "Your account requires a new password. Please set your own password below."
                        : "Sign in with your registered full name and password."}
                </p>
              </div>
              <ThemeToggle />
            </div>

            {showSignUp && (
              <div className="auth-signup-meta">
                <div className="auth-signup-icon" aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" /></svg>
                </div>
                <div>
                  <h3>Sign Up</h3>
                </div>
              </div>
            )}

            <div className="auth-content-scroll">

              {!showSignUp && !showForgotPassword && !showSetPassword && (
                <div className="auth-form-block">
                  <div className="form-group">
                    <label htmlFor="fullName">Full Name</label>
                    <input
                      id="fullName"
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value.toUpperCase())}
                      placeholder="First Middle Last Suffix"
                      autoComplete="name"
                      style={{ textTransform: "uppercase" }}
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="password">Password</label>
                    <input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter password"
                      autoComplete="current-password"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleLogin();
                        }
                      }}
                    />
                  </div>

                  <div className="auth-row">
                    <button type="button" className="btn btn-ghost auth-link-btn" onClick={openForgotPassword}>
                      Forgot password?
                    </button>
                    <button
                      type="button"
                      className={`btn btn-primary ${isLoginButtonDisabled ? "btn-login-disabled" : ""}`}
                      disabled={isLoginButtonDisabled}
                      onClick={handleLogin}
                    >
                      {loading ? "Signing in..." : "Sign In"}
                    </button>
                  </div>

                  <button
                    type="button"
                    className="btn btn-outline"
                    disabled={isLoginRestricted || loading || faceLoginLoading}
                    onClick={startFaceLogin}
                    style={{ width: "100%", marginTop: "0.6rem" }}
                  >
                    {faceLoginLoading ? "Verifying face..." : "Login with Face"}
                  </button>

                  <p className="auth-switch-text">
                    Don&apos;t have an account yet?{" "}
                    <button
                      type="button"
                      className="btn btn-ghost auth-link-btn"
                      onClick={() => {
                        setShowSignUp(true);
                        setShowForgotPassword(false);
                        setError("");
                        setSignupSuccess("");
                      }}
                    >
                      Sign up here
                    </button>
                  </p>
                </div>
              )}

              {showSetPassword && (
                <div className="auth-form-block">
                  <div className="form-group">
                    <label htmlFor="setNewPwd">New Password</label>
                    <input
                      id="setNewPwd"
                      type="password"
                      value={setNewPwd}
                      onChange={(e) => setSetNewPwd(e.target.value)}
                      placeholder="Enter new password"
                      autoComplete="new-password"
                      autoFocus
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="setConfirmPwd">Confirm New Password</label>
                    <input
                      id="setConfirmPwd"
                      type="password"
                      value={setConfirmPwd}
                      onChange={(e) => setSetConfirmPwd(e.target.value)}
                      placeholder="Re-enter new password"
                      autoComplete="new-password"
                      style={setConfirmPwd ? { borderColor: setNewPwd === setConfirmPwd ? "var(--success)" : "var(--danger)" } : undefined}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleSetInitialPassword();
                        }
                      }}
                    />
                    {setConfirmPwd && (
                      <span style={{ fontSize: "0.78rem", marginTop: "0.25rem", color: setNewPwd === setConfirmPwd ? "var(--success-text)" : "var(--danger)" }}>
                        {setNewPwd === setConfirmPwd ? "\u2713 Passwords match" : "\u2717 Passwords do not match"}
                      </span>
                    )}
                  </div>
                  <div className="auth-row" style={{ justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleSetInitialPassword}
                      disabled={setPasswordLoading}
                    >
                      {setPasswordLoading ? "Setting..." : "Set Password"}
                    </button>
                  </div>
                </div>
              )}

              {showForgotPassword && (
                <div className="auth-form-block">
                  <p className="auth-switch-text" style={{ marginTop: 0, marginBottom: "0.7rem" }}>
                    Forgot Password is unavailable for new admin-created accounts until the temporary password is changed after first sign in.
                  </p>

                  {forgotStep === "request" && (
                    <>
                      <div className="form-group">
                        <label htmlFor="forgotFullName">Registered Full Name</label>
                        <input
                          id="forgotFullName"
                          type="text"
                          value={forgotFullName}
                          onChange={(e) => setForgotFullName(e.target.value.toUpperCase())}
                          placeholder="First Middle Last Suffix"
                          autoComplete="name"
                          style={{ textTransform: "uppercase" }}
                        />
                      </div>
                      <div className="auth-row" style={{ justifyContent: "flex-end" }}>
                        <button type="button" className="btn btn-primary" onClick={handleRequestResetCode} disabled={forgotLoading}>
                          {forgotLoading ? "Sending..." : "Send Code"}
                        </button>
                      </div>
                    </>
                  )}

                  {forgotStep === "verify" && (
                    <>
                      <div className="form-group">
                        <label htmlFor="forgotCode">Verification Code</label>
                        <input
                          id="forgotCode"
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          value={forgotCode}
                          onChange={(e) => setForgotCode(e.target.value.replace(/\D/g, ""))}
                          placeholder="000000"
                          style={{ letterSpacing: "0.4em", textAlign: "center", fontWeight: 700 }}
                        />
                      </div>
                      <div className="auth-row">
                        <button type="button" className="btn btn-outline" onClick={handleResendResetCode} disabled={forgotLoading}>
                          {forgotLoading ? "Sending..." : "Resend Code"}
                        </button>
                        <button type="button" className="btn btn-primary" onClick={handleVerifyResetCode} disabled={forgotLoading}>
                          {forgotLoading ? "Verifying..." : "Verify Code"}
                        </button>
                      </div>
                      <p className="auth-switch-text" style={{ marginTop: "0.55rem" }}>
                        Enter only the latest code. Older codes are automatically expired.
                      </p>
                    </>
                  )}

                  {forgotStep === "reset" && (
                    <>
                      <div className="form-group">
                        <label htmlFor="newPassword">New Password</label>
                        <input
                          id="newPassword"
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="Enter new password"
                          autoComplete="new-password"
                        />
                      </div>
                      <div className="form-group">
                        <label htmlFor="confirmPassword">Confirm New Password</label>
                        <input
                          id="confirmPassword"
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="Re-enter new password"
                          autoComplete="new-password"
                          style={confirmPassword ? { borderColor: newPassword === confirmPassword ? "var(--success)" : "var(--danger)" } : undefined}
                        />
                        {confirmPassword && (
                          <span style={{ fontSize: "0.78rem", marginTop: "0.25rem", color: newPassword === confirmPassword ? "var(--success-text)" : "var(--danger)" }}>
                            {newPassword === confirmPassword ? "✓ Passwords match" : "✗ Passwords do not match"}
                          </span>
                        )}
                      </div>
                      <div className="auth-row">
                        <button type="button" className="btn btn-outline" onClick={() => setForgotStep("verify")}>
                          Back
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={handleResetForgottenPassword}
                          disabled={forgotLoading}
                        >
                          {forgotLoading ? "Updating..." : "Reset Password"}
                        </button>
                      </div>
                    </>
                  )}

                  <p className="auth-switch-text">
                    Remembered your password?{" "}
                    <button type="button" className="btn btn-ghost auth-link-btn" onClick={closeForgotPassword}>
                      Go back to login
                    </button>
                  </p>
                </div>
              )}

              {showSignUp && (
                <>
                  <CreateTraineeForm
                    mode="inline"
                    title="Sign Up"
                    subtitle="Create a trainee account. Sign-up accounts are always Trainee role."
                    submitLabel="Create Account"
                    showRoleField={false}
                    defaultRole="trainee"
                    formId="signup-inline-form"
                    showSubmitActions={false}
                    showFormHeader={false}
                    onCreated={() => {
                      setShowSignUp(false);
                      setSignupSuccess("Account created successfully. You can now log in.");
                      setError("");
                    }}
                  />
                </>
              )}

              {displayError && !showSignUp && !showPendingEmailVerify && (
                <div style={{ padding: "0.7rem 0.85rem", borderRadius: "var(--radius-sm)", background: "var(--danger-light)", border: "1px solid var(--danger)", color: "var(--danger)", fontSize: "0.85rem", marginTop: "0.85rem" }}>
                  {displayError}
                </div>
              )}

              {(signupSuccess || (forgotMessage && !showSetPassword)) && (
                <div style={{ padding: "0.7rem 0.85rem", borderRadius: "var(--radius-sm)", background: "var(--success-light)", border: "1px solid var(--success)", color: "var(--success-text)", fontSize: "0.85rem", marginTop: "0.85rem" }}>
                  {signupSuccess || forgotMessage}
                  {showForgotPassword && forgotMaskedEmail ? <span style={{ display: "block", marginTop: "0.35rem" }}>Code target: {forgotMaskedEmail}</span> : null}
                </div>
              )}
            </div>

            {showSignUp && (
              <div className="auth-signup-footer">
                <div className="auth-signup-footer-row">
                  <p className="auth-switch-text" style={{ marginTop: 0 }}>
                    Already have an account?{" "}
                    <button
                      type="button"
                      className="btn btn-ghost auth-link-btn"
                      onClick={() => {
                        setShowSignUp(false);
                        setError("");
                      }}
                    >
                      Login here
                    </button>
                  </p>
                  <button type="submit" form="signup-inline-form" className="btn btn-primary auth-signup-submit" style={{ gap: "0.35rem" }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                    Create Account
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {showPendingEmailVerify && (
        <RightSidebarDrawer onClose={handlePendingLogout} width={470}>
          <div className="card" style={{ margin: 0 }}>
            <div className="drawer-form-header" style={{ marginBottom: "0.85rem" }}>
              <h3 style={{ margin: 0, fontSize: "1.1rem" }}>Verify Updated Email</h3>
              <p style={{ margin: "0.35rem 0 0", color: "var(--text-muted)", fontSize: "0.84rem" }}>
                Login is blocked until this account's updated email is verified.
              </p>
            </div>

            <div style={{ background: "var(--bg-subtle)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "0.7rem", marginBottom: "0.75rem", fontSize: "0.82rem" }}>
              <div>Pending Email: <strong>{pendingEmail || "N/A"}</strong></div>
              {pendingEmailExpiresAt && <div style={{ marginTop: "0.2rem" }}>Expires: <strong>{new Date(pendingEmailExpiresAt).toLocaleString()}</strong></div>}
              <div style={{ marginTop: "0.2rem" }}>Attempts Remaining: <strong>{pendingAttemptsRemaining}</strong></div>
            </div>

            <div className="form-group" style={{ marginBottom: "0.6rem" }}>
              <label htmlFor="pendingEmailCode">Verification Code</label>
              <input
                id="pendingEmailCode"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={pendingCode}
                onChange={(e) => setPendingCode(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (!pendingVerifyLoading && !pendingAdminResendRequired) {
                      handleVerifyPendingEmail();
                    }
                  }
                }}
                placeholder="000000"
                style={{ letterSpacing: "0.35em", textAlign: "center", fontWeight: 700 }}
                disabled={pendingAdminResendRequired}
              />
            </div>

            {(pendingVerifyError || pendingAdminResendRequired) && (
              <div style={{ marginBottom: "0.7rem", padding: "0.55rem 0.7rem", border: "1px solid var(--danger)", borderRadius: "var(--radius-xs)", background: "var(--danger-light)", color: "var(--danger)", fontSize: "0.82rem" }}>
                {pendingAdminResendRequired
                  ? "Maximum attempts reached. Ask your admin to resend a new verification code."
                  : pendingVerifyError}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
              <button type="button" className="btn btn-outline" onClick={handlePendingLogout}>
                Logout
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleVerifyPendingEmail}
                disabled={pendingVerifyLoading || pendingAdminResendRequired}
              >
                {pendingVerifyLoading ? "Verifying..." : "Verify & Continue"}
              </button>
            </div>
          </div>
        </RightSidebarDrawer>
      )}

      <FaceCaptureDialog
        open={showFaceLogin}
        title="Face Login"
        confirmLabel="Verify & Login"
        busy={faceLoginLoading}
        onCancel={() => setShowFaceLogin(false)}
        onConfirm={handleFaceLogin}
      />

      {showMandatoryFaceEnroll && (
        <div style={{ position: "fixed", top: "1rem", right: "1rem", zIndex: 1200, width: "min(92vw, 420px)" }}>
          <div className="card" style={{ margin: 0 }}>
            <h3 style={{ margin: 0, fontSize: "1rem" }}>Face Registration Required</h3>
            <p style={{ margin: "0.35rem 0 0.6rem", color: "var(--text-muted)", fontSize: "0.84rem" }}>
              Register your face to continue. Access is blocked until this step is completed.
            </p>

            {!mandatoryFaceServiceReachable && (
              <div style={{ marginBottom: "0.6rem", padding: "0.55rem 0.7rem", border: "1px solid var(--danger)", borderRadius: "var(--radius-xs)", background: "var(--danger-light)", color: "var(--danger)", fontSize: "0.82rem" }}>
                Face registration is temporarily unavailable. Please try again later or contact your administrator.
              </div>
            )}

            {mandatoryFaceError && (
              <div style={{ marginBottom: "0.6rem", padding: "0.55rem 0.7rem", border: "1px solid var(--danger)", borderRadius: "var(--radius-xs)", background: "var(--danger-light)", color: "var(--danger)", fontSize: "0.82rem" }}>
                {mandatoryFaceError}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-outline" onClick={handleMandatoryFaceLogout}>
                Logout
              </button>
            </div>
          </div>
        </div>
      )}

      <FaceCaptureDialog
        open={showMandatoryFaceEnroll && mandatoryFaceServiceReachable}
        title="Register Your Face"
        confirmLabel="Enroll Face"
        busy={mandatoryFaceEnrollLoading}
        onCancel={handleMandatoryFaceLogout}
        onConfirm={handleMandatoryFaceEnroll}
      />

      <style jsx>{`
        .auth-shell {
          height: 100dvh;
          display: grid;
          grid-template-columns: 2fr 1fr;
          background: var(--bg);
          overflow: hidden;
        }

        .auth-visual {
          position: relative;
          isolation: isolate;
          height: 100dvh;
          background-image: url("/images/login-bg.png");
          background-size: cover;
          background-position: center;
          overflow: hidden;
        }

        .auth-visual-overlay {
          position: absolute;
          inset: 0;
          background:
            radial-gradient(circle at 18% 20%, rgba(255, 208, 132, 0.28), transparent 37%),
            radial-gradient(circle at 86% 76%, rgba(130, 255, 225, 0.24), transparent 38%),
            linear-gradient(145deg, rgba(58, 120, 150, 0.3), rgba(82, 162, 176, 0.28));
          z-index: -1;
        }

        .auth-kicker {
          letter-spacing: 0.18em;
          text-transform: uppercase;
          font-size: 0.74rem;
          color: var(--text-muted);
          font-weight: 700;
        }

        .auth-panel-wrap {
          height: 100dvh;
          background: var(--surface);
          padding: 0;
          display: flex;
          align-items: stretch;
          justify-content: stretch;
          overflow: hidden;
        }

        .auth-panel {
          width: 100%;
          height: 100%;
          background: transparent;
          border: none;
          box-shadow: none;
          padding: clamp(1rem, 2.2vw, 1.6rem);
          display: flex;
          justify-content: center;
          overflow: hidden;
        }

        .auth-panel-inner {
          width: min(100%, 620px);
          height: 100%;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
          gap: 0.95rem;
          min-height: 0;
        }

        .auth-panel-inner.is-centered {
          justify-content: center;
          transform: translateY(-12vh);
        }

        .auth-panel-inner.is-centered .auth-content-scroll {
          flex: 0;
          overflow: visible;
          padding-right: 0;
        }

        .auth-content-scroll {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          overflow-x: hidden;
          padding-right: 0.15rem;
        }

        .auth-signup-meta {
          display: flex;
          align-items: flex-start;
          gap: 0.75rem;
          padding: 0.55rem 0.15rem 0.1rem;
          flex-shrink: 0;
        }

        .auth-signup-icon {
          width: 2.35rem;
          height: 2.35rem;
          border-radius: var(--radius-sm);
          background: var(--primary-light);
          color: var(--primary);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .auth-signup-meta h3 {
          font-size: 1.3rem;
          margin: 0;
          color: var(--text);
          line-height: 1.2;
          font-family: "Space Grotesk", "Segoe UI", sans-serif;
        }

        .auth-signup-meta p {
          margin: 0.2rem 0 0;
          color: var(--text-muted);
          font-size: 0.85rem;
          line-height: 1.45;
        }

        .auth-panel-inner.is-signup .auth-content-scroll {
          padding-right: 0.35rem;
        }

        .auth-signup-footer {
          flex-shrink: 0;
          border-top: 1px solid var(--border);
          padding-top: 0.55rem;
          margin-top: 0.2rem;
          background: var(--surface);
        }

        .auth-signup-footer-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.75rem;
        }

        .auth-signup-submit {
          flex-shrink: 0;
        }

        .auth-meta {
          margin-bottom: 0.25rem;
        }

        .auth-meta h1 {
          font-size: clamp(1.95rem, 3vw, 2.5rem);
          line-height: 1.14;
          margin: 0.25rem 0 0.55rem;
          color: var(--text);
          font-family: "Space Grotesk", "Segoe UI", sans-serif;
        }

        .auth-meta p {
          margin: 0;
          color: var(--text-muted);
          font-size: 0.97rem;
          line-height: 1.62;
        }

        .auth-stat-row {
          margin-top: 1.15rem;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 0.72rem;
        }

        .auth-stat-row div {
          padding: 0.72rem 0.74rem;
          border: 1px solid var(--border);
          background: var(--card);
          border-radius: 0.6rem;
        }

        .auth-stat-row span {
          display: block;
          font-size: 0.7rem;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: 0.22rem;
        }

        .auth-stat-row strong {
          font-size: 0.9rem;
          color: var(--text);
        }

        .auth-panel-header {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          align-items: flex-start;
          margin-bottom: 0.2rem;
          flex-shrink: 0;
        }

        .auth-panel-header h2 {
          font-family: "Space Grotesk", "Segoe UI", sans-serif;
          font-size: clamp(1.7rem, 2.1vw, 2rem);
          margin: 0;
          color: var(--text);
          line-height: 1.14;
        }

        .auth-panel-header p {
          margin-top: 0.72rem;
          color: var(--text-muted);
          font-size: 0.92rem;
          line-height: 1.5;
        }

        .auth-form-block {
          display: flex;
          flex-direction: column;
          gap: 0.34rem;
        }

        .auth-row {
          margin-top: 0.2rem;
          display: flex;
          justify-content: space-between;
          gap: 0.55rem;
          align-items: center;
        }

        .auth-link-btn {
          padding: 0;
          color: var(--primary);
          font-weight: 600;
        }

        .auth-link-btn:hover {
          background: transparent;
          color: var(--primary-hover);
        }

        .auth-switch-text {
          margin-top: 0.8rem;
          font-size: 0.84rem;
          color: var(--text-muted);
        }

        .btn-login-disabled {
          opacity: 0.56;
          filter: saturate(0.35);
          cursor: not-allowed !important;
        }

        .auth-panel :global(.form-group input),
        .auth-panel :global(.form-group textarea),
        .auth-panel :global(.form-group select) {
          transition: none;
        }

        .auth-panel :global(.card) {
          background: var(--card);
          border: 1px solid var(--border);
          box-shadow: var(--shadow-sm);
        }

        @media (max-width: 1024px) {
          .auth-shell {
            grid-template-columns: 1fr;
            height: auto;
            overflow: auto;
          }

          .auth-visual {
            min-height: 40vh;
            height: 40vh;
          }

          .auth-panel-wrap {
            min-height: auto;
            height: auto;
            overflow: visible;
          }

          .auth-panel {
            min-height: auto;
            height: auto;
            overflow: visible;
          }

          .auth-panel-inner {
            min-height: auto;
            height: auto;
            justify-content: flex-start;
          }

          .auth-panel-inner.is-centered {
            transform: none;
          }

          .auth-content-scroll {
            overflow: visible;
            padding-right: 0;
          }

          .auth-signup-footer {
            border-top: none;
            padding-top: 0;
            margin-top: 0.55rem;
          }

          .auth-signup-footer-row {
            flex-direction: column;
            align-items: stretch;
          }

          .auth-signup-submit {
            width: 100%;
          }
        }

        @media (max-width: 680px) {
          .auth-visual {
            display: none;
          }

          .auth-panel-wrap {
            min-height: 100vh;
            padding: 0;
          }

          .auth-panel {
            min-height: 100vh;
            padding: 1rem;
          }

          .auth-row {
            flex-wrap: wrap;
          }

          .auth-row :global(button) {
            width: 100%;
          }

          .auth-stat-row {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}
