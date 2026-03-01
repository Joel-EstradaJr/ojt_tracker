// ============================================================
// API Helper — centralised fetch wrapper for the backend.
// Uses the Next.js rewrite so all calls go to /api/…
// ============================================================

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

export function createTrainee(data: {
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
  return request<import("@/types").Trainee>("/api/trainees", {
    method: "POST",
    body: JSON.stringify(data),
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

export function verifyPassword(id: string, password: string) {
  return request<import("@/types").Trainee>(`/api/trainees/${id}/verify`, {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export function resetPassword(id: string, newPassword: string) {
  return request<{ message: string }>(`/api/trainees/${id}/reset-password`, {
    method: "PUT",
    body: JSON.stringify({ newPassword }),
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

export function createLog(data: {
  traineeId: string;
  date: string;
  timeIn: string;
  lunchStart: string;
  lunchEnd: string;
  timeOut: string;
  accomplishment: string;
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
