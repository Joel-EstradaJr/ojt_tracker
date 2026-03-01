// ============================================================
// API Helper — centralised fetch wrapper for the backend.
// Uses the Next.js rewrite so all calls go to /api/…
// ============================================================

import { sha256 } from "./hash";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

async function request<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
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
  return request<import("@/types").Trainee[]>("/api/trainees");
}

export function fetchTrainee(id: string) {
  return request<import("@/types").Trainee>(`/api/trainees/${id}`);
}

export async function createTrainee(data: {
  lastName: string;
  firstName: string;
  middleName?: string;
  suffix?: string;
  email: string;
  contactNumber: string;
  school: string;
  companyName: string;
  requiredHours: number;
  password: string;
  supervisors?: import("@/types").SupervisorInput[];
}) {
  const hashedPassword = await sha256(data.password);
  return request<import("@/types").Trainee>("/api/trainees", {
    method: "POST",
    body: JSON.stringify({ ...data, password: hashedPassword }),
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
  }
) {
  return request<import("@/types").Trainee>(`/api/trainees/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function verifyPassword(id: string, password: string) {
  const hashed = await sha256(password);
  return request<import("@/types").Trainee>(`/api/trainees/${id}/verify`, {
    method: "POST",
    body: JSON.stringify({ password: hashed }),
  });
}

export async function resetPassword(id: string, newPassword: string) {
  const hashed = await sha256(newPassword);
  return request<{ message: string }>(`/api/trainees/${id}/reset-password`, {
    method: "PUT",
    body: JSON.stringify({ newPassword: hashed }),
  });
}

export function deleteTrainee(id: string) {
  return request<{ message: string }>(`/api/trainees/${id}`, {
    method: "DELETE",
  });
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
  lunchStart: string;
  lunchEnd: string;
  timeOut: string;
  accomplishment: string;
  applyOffset?: boolean;
  offsetAmount?: number;
}) {
  return request<import("@/types").LogEntry>("/api/logs", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateLog(
  id: string,
  data: {
    date: string;
    timeIn: string;
    lunchStart: string;
    lunchEnd: string;
    timeOut: string;
    accomplishment: string;
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

// ── Export helpers (trigger download) ────────────────────────

export function downloadExport(traineeId: string, format: "csv" | "excel" | "pdf") {
  window.open(`${BASE}/api/export/${format}/${traineeId}`, "_blank");
}

// ── Import CSV ───────────────────────────────────────────────

export async function importCSV(traineeId: string, file: File) {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${BASE}/api/import/csv/${traineeId}`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as Record<string, string>).error || res.statusText);
  }

  return res.json() as Promise<{ imported: number }>;
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
