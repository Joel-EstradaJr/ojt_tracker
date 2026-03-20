// ============================================================
// API Helper — centralised fetch wrapper for the backend.
// Uses the Next.js rewrite so all calls go to /api/…
// ============================================================

import { sha256 } from "./hash";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

async function request<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...opts?.headers },
    ...opts,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as Record<string, string>).error || res.statusText);
  }

  // Handle empty bodies (204, etc.)
  const text = await res.text();
  return text ? JSON.parse(text) : ({} as T);
}

// ── Trainee endpoints ────────────────────────────────────────

export function fetchTrainees() {
  return request<import("@/types").UserProfile[]>("/api/trainees");
}

export function fetchTrainee(id: string) {
  return request<import("@/types").UserProfile>(`/api/trainees/${id}`);
}

export async function createTrainee(data: {
  role?: "admin" | "trainee";
  lastName: string;
  firstName: string;
  middleName?: string;
  suffix?: string;
  email: string;
  contactNumber: string;
  school: string;
  companyName: string;
  requiredHours: number;
  workSchedule?: Record<string, { start: string; end: string }>;
  password?: string;
  supervisors?: import("@/types").SupervisorInput[];
  verificationToken?: string;
}) {
  const payload: Record<string, unknown> = { ...data };
  if (data.password) {
    payload.password = await sha256(data.password);
  }
  return request<import("@/types").UserProfile>("/api/trainees", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateTrainee(
  id: string,
  data: {
    lastName: string;
    firstName: string;
    middleName?: string;
    suffix?: string;
    email: string;
    contactNumber: string;
    school: string;
    companyName: string;
    requiredHours: number;
    workSchedule?: Record<string, { start: string; end: string }>;
    verificationToken?: string;
  }
) {
  return request<import("@/types").UserProfile>(`/api/trainees/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function verifyPassword(id: string, password: string) {
  const hashed = await sha256(password);
  return request<import("@/types").UserProfile>(`/api/trainees/${id}/verify`, {
    method: "POST",
    body: JSON.stringify({ password: hashed }),
  });
}

export async function resetPassword(id: string, newPassword: string, resetToken: string) {
  const hashed = await sha256(newPassword);
  return request<{ message: string }>(`/api/trainees/${id}/reset-password`, {
    method: "PUT",
    body: JSON.stringify({ newPassword: hashed, resetToken }),
  });
}

export async function forgotPassword(id: string) {
  // Call relative path to hit the Vercel API route (not Railway directly)
  // because Railway blocks SMTP — email is sent from Vercel.
  const res = await fetch(`/api/trainees/${id}/forgot-password`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as Record<string, string>).error || res.statusText);
  }
  return res.json() as Promise<{ message: string; maskedEmail: string }>;
}

export function verifyResetCode(id: string, code: string) {
  return request<{ message: string; resetToken: string }>(`/api/trainees/${id}/verify-reset-code`, {
    method: "POST",
    body: JSON.stringify({ code }),
  });
}

export async function deleteTrainee(
  id: string,
  options?: { currentPassword?: string; typedConfirmation?: string }
) {
  const payload: { currentPassword?: string; typedConfirmation?: string } = {};
  if (options?.typedConfirmation) payload.typedConfirmation = options.typedConfirmation;
  if (options?.currentPassword) payload.currentPassword = await sha256(options.currentPassword);

  return request<{ message: string }>(`/api/trainees/${id}`, {
    method: "DELETE",
    body: JSON.stringify(payload),
  });
}

// ── Email verification endpoints ─────────────────────────────
// These use fetch() directly (no BASE prefix) so they always hit
// the Vercel API routes, which handle email sending via SMTP.
// Railway blocks outbound SMTP, so emails must be sent from Vercel.

export async function sendEmailVerification(email: string) {
  const res = await fetch("/api/email/send-verification", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as Record<string, string>).error || res.statusText);
  }
  return res.json() as Promise<{ message: string }>;
}

export async function verifyEmailCode(email: string, code: string) {
  const res = await fetch("/api/email/verify-code", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as Record<string, string>).error || res.statusText);
  }
  return res.json() as Promise<{ message: string; verificationToken: string }>;
}

// ── Supervisor endpoints ─────────────────────────────────────

export function fetchSupervisors(traineeId: string) {
  return request<import("@/types").Supervisor[]>(`/api/supervisors/${traineeId}`);
}

export function createSupervisor(traineeId: string, data: import("@/types").SupervisorInput) {
  return request<import("@/types").Supervisor>(`/api/supervisors/${traineeId}`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function deleteSupervisor(id: string) {
  return request<{ message: string }>(`/api/supervisors/entry/${id}`, {
    method: "DELETE",
  });
}

export function updateSupervisor(id: string, data: import("@/types").SupervisorInput) {
  return request<import("@/types").Supervisor>(`/api/supervisors/entry/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

// ── Log endpoints ────────────────────────────────────────────

export function fetchLogs(traineeId: string) {
  return request<import("@/types").LogsResponse>(`/api/logs/${traineeId}`);
}

export function fetchOffset(traineeId: string) {
  return request<{ availableOffset: number }>(`/api/logs/offset/${traineeId}`);
}

export function createLog(data: {
  traineeId: string;
  date: string;
  timeIn: string;
  lunchStart?: string;
  lunchEnd?: string;
  timeOut?: string;
  accomplishment?: string;
  applyOffset?: boolean;
  offsetAmount?: number;
}) {
  return request<import("@/types").LogEntry>("/api/logs", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function patchLogAction(logId: string, data: {
  action: "lunchStart" | "lunchEnd" | "timeOut" | "accomplishment" | "offset";
  timestamp?: string;
  accomplishment?: string;
  offsetMinutes?: number;
}) {
  return request<import("@/types").LogEntry>(`/api/logs/${logId}/action`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function updateLog(
  id: string,
  data: {
    date?: string;
    timeIn?: string;
    lunchStart?: string;
    lunchEnd?: string;
    timeOut?: string;
    accomplishment?: string;
    applyOffset?: boolean;
    offsetAmount?: number;
  }
) {
  return request<import("@/types").LogEntry>(`/api/logs/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function deleteLog(id: string) {
  return request<{ message: string }>(`/api/logs/entry/${id}`, {
    method: "DELETE",
  });
}

// ── Accomplishment scripts ───────────────────────────────────

export function fetchAccomplishmentScripts(traineeId: string) {
  return request<import("@/types").AccomplishmentScript[]>(`/api/scripts/${traineeId}`);
}

export function createAccomplishmentScript(
  traineeId: string,
  data: { title: string; content: string }
) {
  return request<import("@/types").AccomplishmentScript>(`/api/scripts/${traineeId}`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateAccomplishmentScript(
  scriptId: string,
  data: { title: string; content: string }
) {
  return request<import("@/types").AccomplishmentScript>(`/api/scripts/entry/${scriptId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

// ── Export helpers (trigger download) ────────────────────────

export async function downloadExport(traineeId: string, format: "csv" | "excel" | "pdf") {
  const res = await fetch(`${BASE}/api/export/${format}/${traineeId}`, {
    credentials: "include",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as Record<string, string>).error || res.statusText);
  }
  const blob = await res.blob();
  const disposition = res.headers.get("content-disposition");
  const filenameMatch = disposition?.match(/filename="?([^"]+)"?/);
  const filename = filenameMatch?.[1] ?? `export.${format === "excel" ? "xlsx" : format}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── Import CSV ───────────────────────────────────────────────

export async function importCSV(traineeId: string, file: File) {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${BASE}/api/import/csv/${traineeId}`, {
    method: "POST",
    credentials: "include",
    body: form,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as Record<string, string>).error || res.statusText);
  }

  return res.json() as Promise<{ imported: number }>;
}

// ── Bulk Export / Import (full database) ─────────────────────

// ── Auth ──────────────────────────────────────────────────────

export interface SessionInfo {
  authenticated: boolean;
  role?: "admin" | "trainee";
  traineeId?: string | null;
  expiresAt?: number | null;
  currentUser?: {
    id?: string | null;
    displayName: string;
    email?: string | null;
    isSuper?: boolean;
  };
}

export interface LoginSecurityDetails {
  failedAttempts?: number;
  attemptsRemainingBeforeLock?: number;
  cooldown?: boolean;
  retryAfterSeconds?: number;
  accountLocked?: boolean;
  lockoutUserId?: string;
  lockoutEndsAt?: string;
}

export class LoginError extends Error {
  details: LoginSecurityDetails;

  constructor(message: string, details: LoginSecurityDetails = {}) {
    super(message);
    this.name = "LoginError";
    this.details = details;
  }
}

export function isLoginError(error: unknown): error is LoginError {
  return error instanceof LoginError;
}

export async function login(fullName: string, password: string) {
  const hashed = await sha256(password);

  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fullName,
      identifier: fullName,
      password: hashed,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const payload = body as {
      error?: string;
      failedAttempts?: number;
      attemptsRemainingBeforeLock?: number;
      cooldown?: boolean;
      retryAfterSeconds?: number;
      accountLocked?: boolean;
      lockoutUserId?: string;
      lockoutEndsAt?: string;
    };

    throw new LoginError(payload.error || res.statusText, {
      failedAttempts: payload.failedAttempts,
      attemptsRemainingBeforeLock: payload.attemptsRemainingBeforeLock,
      cooldown: payload.cooldown,
      retryAfterSeconds: payload.retryAfterSeconds,
      accountLocked: payload.accountLocked,
      lockoutUserId: payload.lockoutUserId,
      lockoutEndsAt: payload.lockoutEndsAt,
    });
  }

  return res.json() as Promise<{ message: string; role: "admin" | "trainee"; traineeId?: string | null; mustChangePassword?: boolean }>;
}

export async function requestForgotPasswordCode(fullName: string) {
  const res = await fetch("/api/auth/forgot-password/request-code", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fullName }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as Record<string, string>).error || res.statusText);
  }

  return res.json() as Promise<{ message: string; maskedEmail?: string }>;
}

export function verifyForgotPasswordCode(fullName: string, code: string) {
  return request<{ message: string; resetToken: string }>("/api/auth/forgot-password/verify-code", {
    method: "POST",
    body: JSON.stringify({ fullName, code }),
  });
}

export async function resetForgottenPassword(fullName: string, newPassword: string, confirmPassword: string, resetToken: string) {
  const hashed = await sha256(newPassword);
  const hashedConfirm = await sha256(confirmPassword);

  return request<{ message: string }>("/api/auth/forgot-password/reset", {
    method: "POST",
    body: JSON.stringify({
      fullName,
      resetToken,
      newPassword: hashed,
      confirmPassword: hashedConfirm,
    }),
  });
}

export function getSession() {
  return request<SessionInfo>("/api/auth/me");
}

export async function verifySuperPassword(password: string) {
  const hashed = await sha256(password);
  return request<{ message: string }>("/api/auth/verify-super", {
    method: "POST",
    body: JSON.stringify({ password: hashed }),
  });
}

export function checkSession(traineeId: string) {
  return request<{ authenticated: boolean; expiresAt?: number }>(`/api/auth/session/${traineeId}`);
}

export function logout() {
  return request<{ message: string }>("/api/auth/logout", { method: "POST" });
}

export async function setInitialPassword(traineeId: string, currentPassword: string, newPassword: string, confirmPassword: string) {
  const hashedCurrent = await sha256(currentPassword);
  const hashedNew = await sha256(newPassword);
  const hashedConfirm = await sha256(confirmPassword);

  return request<{ message: string; role: "admin" | "trainee"; traineeId?: string | null }>("/api/auth/set-initial-password", {
    method: "POST",
    body: JSON.stringify({
      traineeId,
      currentPassword: hashedCurrent,
      newPassword: hashedNew,
      confirmPassword: hashedConfirm,
    }),
  });
}

export function resendTempPassword(traineeId: string) {
  return request<{ message: string }>(`/api/trainees/${traineeId}/resend-temp-password`, {
    method: "POST",
  });
}

// ── Bulk Export / Import (full database) ─────────────────────

export function downloadAllCSV() {
  window.open(`${BASE}/api/export/all`, "_blank");
}

export async function importAllCSV(file: File) {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${BASE}/api/import/all`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as Record<string, string>).error || res.statusText);
  }

  return res.json() as Promise<{ trainees: number; supervisors: number; logs: number; skipped: number }>;
}

// ── Settings endpoints ────────────────────────────────────────

export interface SystemSettings {
  countEarlyInAsOT: boolean;
  countLateOutAsOT: boolean;
  countEarlyLunchEndAsOT: boolean;
}

export function fetchSettings() {
  return request<SystemSettings>("/api/settings");
}

export function updateSettings(data: Partial<SystemSettings>) {
  return request<SystemSettings>("/api/settings", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}
