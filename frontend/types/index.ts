// ============================================================
// Shared TypeScript types for the frontend
// ============================================================

/** User profile as returned by the API (no passwordHash) */
export interface UserProfile {
  id: string;
  role: "admin" | "trainee";
  lastName: string;
  firstName: string;
  middleName?: string | null;
  suffix?: string | null;
  email: string;
  contactNumber: string;
  school: string;
  companyName: string;
  requiredHours: number;
  displayName: string;
  createdAt: string;
  updatedAt: string;
  totalHoursRendered: number;
  mustChangePassword?: boolean;
  lockedUntil?: string | null;
  workSchedule?: Record<string, { start: string; end: string }>;
  supervisors?: Supervisor[];
}

// Backward-compatible alias while frontend components are migrated.
export type Trainee = UserProfile;

/** Supervisor belonging to a trainee */
export interface Supervisor {
  id: string;
  traineeId: string;
  lastName: string;
  firstName: string;
  middleName?: string | null;
  suffix?: string | null;
  contactNumber?: string | null;
  email?: string | null;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

/** Supervisor form data (for creating inline with trainee) */
export interface SupervisorInput {
  lastName: string;
  firstName: string;
  middleName?: string;
  suffix?: string;
  contactNumber?: string;
  email?: string;
}

/** A single time-log entry */
export interface LogEntry {
  id: string;
  traineeId: string;
  date: string;
  timeIn: string;
  lunchStart: string;
  lunchEnd: string;
  timeOut: string | null;
  hoursWorked: number;
  overtime: number;
  offsetUsed: number;
  accomplishment: string | null;
  createdAt: string;
}

/** Response shape from GET /logs/:traineeId */
export interface LogsResponse {
  logs: LogEntry[];
  totalHours: number;
  totalOvertime: number;
  totalOffsetUsed: number;
  availableOffset: number;
}

export interface AccomplishmentScript {
  id: string;
  traineeId: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}
