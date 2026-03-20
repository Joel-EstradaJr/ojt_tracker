// ============================================================
// Philippine Holidays Utility
// Generates regular holidays, special non-working days,
// and identifies weekends (Saturday/Sunday).
// ============================================================

export interface HolidayInfo {
  date: string;        // yyyy-MM-dd
  name: string;
  type: "regular" | "special";
}

// ── Easter calculation (Anonymous Gregorian / Meeus-Jones-Butcher) ──
function computeEasterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

// ── Last Monday of a given month ──
function lastMondayOf(year: number, month: number): Date {
  const d = new Date(year, month + 1, 0); // last day of month
  const dayOfWeek = d.getDay();
  const diff = (dayOfWeek + 6) % 7; // days since last Monday
  d.setDate(d.getDate() - diff);
  return d;
}

// ── Chinese New Year (hardcoded — lunar calendar) ──
const CHINESE_NEW_YEAR: Record<number, string> = {
  2024: "02-10",
  2025: "01-29",
  2026: "02-17",
  2027: "02-06",
  2028: "01-26",
  2029: "02-13",
  2030: "02-03",
};

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/**
 * Returns all Philippine holidays for a given year.
 */
export function getPhilippineHolidays(year: number): HolidayInfo[] {
  const holidays: HolidayInfo[] = [];

  // ── Regular Holidays ──
  holidays.push({ date: `${year}-01-01`, name: "New Year's Day", type: "regular" });
  holidays.push({ date: `${year}-04-09`, name: "Araw ng Kagitingan", type: "regular" });
  holidays.push({ date: `${year}-05-01`, name: "Labor Day", type: "regular" });
  holidays.push({ date: `${year}-06-12`, name: "Independence Day", type: "regular" });
  holidays.push({ date: `${year}-11-30`, name: "Bonifacio Day", type: "regular" });
  holidays.push({ date: `${year}-12-25`, name: "Christmas Day", type: "regular" });
  holidays.push({ date: `${year}-12-30`, name: "Rizal Day", type: "regular" });

  // National Heroes Day — last Monday of August
  const heroesDay = lastMondayOf(year, 7); // month index 7 = August
  holidays.push({ date: fmt(heroesDay), name: "National Heroes Day", type: "regular" });

  // Easter-based holidays
  const easter = computeEasterSunday(year);
  const maundyThursday = addDays(easter, -3);
  const goodFriday = addDays(easter, -2);
  const blackSaturday = addDays(easter, -1);
  holidays.push({ date: fmt(maundyThursday), name: "Maundy Thursday", type: "regular" });
  holidays.push({ date: fmt(goodFriday), name: "Good Friday", type: "regular" });
  holidays.push({ date: fmt(blackSaturday), name: "Black Saturday", type: "special" });

  // ── Special Non-Working Days ──
  holidays.push({ date: `${year}-02-25`, name: "EDSA People Power Anniversary", type: "special" });
  holidays.push({ date: `${year}-08-21`, name: "Ninoy Aquino Day", type: "special" });
  holidays.push({ date: `${year}-11-01`, name: "All Saints' Day", type: "special" });
  holidays.push({ date: `${year}-11-02`, name: "All Souls' Day", type: "special" });
  holidays.push({ date: `${year}-12-08`, name: "Feast of the Immaculate Conception", type: "special" });
  holidays.push({ date: `${year}-12-31`, name: "Last Day of the Year", type: "special" });
  holidays.push({ date: `${year}-12-24`, name: "Christmas Eve", type: "special" });

  // Chinese New Year (if we have data for this year)
  if (CHINESE_NEW_YEAR[year]) {
    holidays.push({ date: `${year}-${CHINESE_NEW_YEAR[year]}`, name: "Chinese New Year", type: "special" });
  }

  return holidays;
}

/**
 * Build a Set of "yyyy-MM-dd" strings for quick lookup.
 */
export function getHolidayMap(year: number): Map<string, HolidayInfo> {
  const map = new Map<string, HolidayInfo>();
  for (const h of getPhilippineHolidays(year)) {
    map.set(h.date, h);
  }
  return map;
}

// Work schedule type
export type WorkSchedule = Record<string, { start: string; end: string }>;

export const DEFAULT_WORK_SCHEDULE: WorkSchedule = {
  "1": { start: "08:00", end: "17:00" },
  "2": { start: "08:00", end: "17:00" },
  "3": { start: "08:00", end: "17:00" },
  "4": { start: "08:00", end: "17:00" },
  "5": { start: "08:00", end: "17:00" },
};

/**
 * Check if a date is a non-working day based on workSchedule.
 */
export function isNonWorkDay(d: Date, schedule?: WorkSchedule | null): boolean {
  const sched = schedule || DEFAULT_WORK_SCHEDULE;
  return !(String(d.getDay()) in sched);
}

/** Backward-compatible alias: checks Saturday/Sunday only */
export function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

/**
 * Check if a given date is a working day
 * (present in workSchedule and not a Philippine holiday).
 */
export function isWorkingDay(d: Date, schedule?: WorkSchedule | null): boolean {
  if (isNonWorkDay(d, schedule)) return false;
  const ds = fmt(d);
  const map = getHolidayMap(d.getFullYear());
  return !map.has(ds);
}

/**
 * Calculate hours for a specific day from schedule.
 * Subtracts 1 hour for lunch. Returns 0 for non-work days.
 */
export function getHoursForDay(schedule: WorkSchedule | null | undefined, dayOfWeek: number): number {
  const sched = schedule || DEFAULT_WORK_SCHEDULE;
  const entry = sched[String(dayOfWeek)];
  if (!entry) return 0;
  const [sh, sm] = entry.start.split(":").map(Number);
  const [eh, em] = entry.end.split(":").map(Number);
  const totalMinutes = (eh * 60 + em) - (sh * 60 + sm);
  const workedMinutes = totalMinutes - 60;
  return workedMinutes > 0 ? parseFloat((workedMinutes / 60).toFixed(2)) : 8;
}

/**
 * Calculate average hours per working day from schedule.
 */
export function getHoursPerDay(schedule?: WorkSchedule | null): number {
  const sched = schedule || DEFAULT_WORK_SCHEDULE;
  const days = Object.keys(sched);
  if (days.length === 0) return 8;
  let total = 0;
  for (const dayNum of days) {
    total += getHoursForDay(sched, Number(dayNum));
  }
  return parseFloat((total / days.length).toFixed(2));
}

/**
 * Calculate expected end date given remaining hours.
 * Iterates day-by-day, subtracting each work day's specific hours.
 */
export function calculateExpectedEndDate(
  remainingHours: number,
  startDate?: Date,
  schedule?: WorkSchedule | null,
): Date {
  const cursor = startDate ? new Date(startDate) : new Date();
  cursor.setHours(0, 0, 0, 0);

  if (remainingHours <= 0) return cursor;

  let hoursLeft = remainingHours;
  while (hoursLeft > 0) {
    cursor.setDate(cursor.getDate() + 1);
    if (isWorkingDay(cursor, schedule)) {
      hoursLeft -= getHoursForDay(schedule, cursor.getDay());
    }
  }
  return cursor;
}
