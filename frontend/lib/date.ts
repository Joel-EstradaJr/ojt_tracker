const DEFAULT_TIME_ZONE = "Asia/Manila";

const formatterCache = new Map<string, Intl.DateTimeFormat>();
const inputFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getDisplayDateFormatter(timeZone: string) {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "2-digit",
    year: "numeric",
    timeZone,
  });

  formatterCache.set(timeZone, formatter);
  return formatter;
}

export function formatDisplayDate(
  value: string | number | Date,
  options?: { timeZone?: string },
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const timeZone = options?.timeZone ?? DEFAULT_TIME_ZONE;

  const parts = getDisplayDateFormatter(timeZone).formatToParts(date);

  const weekday = parts.find(p => p.type === "weekday")?.value;
  const month = parts.find(p => p.type === "month")?.value;
  const day = parts.find(p => p.type === "day")?.value;
  const year = parts.find(p => p.type === "year")?.value;

  return `${weekday} | ${month} ${day}, ${year}`; // DATE FORMATTER
}

export function formatDisplayDateFromDateOnly(value: string): string {
  return formatDisplayDate(`${value}T00:00:00+08:00`);
}

function getDateInputFormatter(timeZone: string) {
  const cached = inputFormatterCache.get(timeZone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  });

  inputFormatterCache.set(timeZone, formatter);
  return formatter;
}

export function toDateInputValue(
  value: string | number | Date,
  options?: { timeZone?: string },
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const timeZone = options?.timeZone ?? DEFAULT_TIME_ZONE;
  return getDateInputFormatter(timeZone).format(date);
}
