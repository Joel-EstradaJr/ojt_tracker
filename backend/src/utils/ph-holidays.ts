// ============================================================
// Philippine Holidays Utility (Backend)
// Same logic as frontend/lib/ph-holidays.ts — generates
// holidays, checks weekends, and calculates expected end dates.
// ============================================================

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

function lastMondayOf(year: number, month: number): Date {
  const d = new Date(year, month + 1, 0);
  const dayOfWeek = d.getDay();
  const diff = (dayOfWeek + 6) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

const CHINESE_NEW_YEAR: Record<number, string> = {
  2024: "02-10", 2025: "01-29", 2026: "02-17", 2027: "02-06",
  2028: "01-26", 2029: "02-13", 2030: "02-03",
};

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function getHolidaySet(year: number): Set<string> {
  const s = new Set<string>();
  const add = (ds: string) => s.add(ds);

  add(`${year}-01-01`);
  add(`${year}-04-09`);
  add(`${year}-05-01`);
  add(`${year}-06-12`);
  add(`${year}-11-30`);
  add(`${year}-12-25`);
  add(`${year}-12-30`);
  add(fmt(lastMondayOf(year, 7)));

  const easter = computeEasterSunday(year);
  add(fmt(addDays(easter, -3)));
  add(fmt(addDays(easter, -2)));
  add(fmt(addDays(easter, -1)));

  add(`${year}-02-25`);
  add(`${year}-08-21`);
  add(`${year}-11-01`);
  add(`${year}-11-02`);
  add(`${year}-12-08`);
  add(`${year}-12-31`);
  add(`${year}-12-24`);

  if (CHINESE_NEW_YEAR[year]) add(`${year}-${CHINESE_NEW_YEAR[year]}`);
  return s;
}

function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

function isWorkingDay(d: Date): boolean {
  if (isWeekend(d)) return false;
  return !getHolidaySet(d.getFullYear()).has(fmt(d));
}

/**
 * Calculate the expected end date given remaining working days.
 * Skips weekends and PH holidays.
 */
export function calculateExpectedEndDate(remainingDays: number, startDate?: Date): Date {
  const cursor = startDate ? new Date(startDate) : new Date();
  cursor.setHours(0, 0, 0, 0);
  if (remainingDays <= 0) return cursor;

  let counted = 0;
  while (counted < remainingDays) {
    cursor.setDate(cursor.getDate() + 1);
    if (isWorkingDay(cursor)) counted++;
  }
  return cursor;
}
