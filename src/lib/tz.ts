/**
 * Small time-zone helpers built on Intl so the app needs no date library.
 * All persisted instants are UTC; these helpers only translate wall-clock
 * times for display and for form inputs.
 */

export interface WallTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock time of an instant in the given zone. */
export function toWallTime(date: Date, timeZone: string): WallTime {
  const parts = partsFormatter(timeZone).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset of the zone from UTC at the given instant, in minutes (east positive). */
export function zoneOffsetMinutes(date: Date, timeZone: string): number {
  const wall = toWallTime(date, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  const truncated = Math.floor(date.getTime() / 1000) * 1000;
  return Math.round((asUtc - truncated) / 60000);
}

/** The instant at which a wall-clock time occurs in the given zone. */
export function wallTimeToUtc(wall: Omit<WallTime, "second"> & { second?: number }, timeZone: string): Date {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second ?? 0);
  const firstOffset = zoneOffsetMinutes(new Date(naive), timeZone);
  let guess = naive - firstOffset * 60000;
  const secondOffset = zoneOffsetMinutes(new Date(guess), timeZone);
  if (secondOffset !== firstOffset) {
    guess = naive - secondOffset * 60000;
  }
  return new Date(guess);
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** Value for an <input type="datetime-local"> showing the instant in the given zone. */
export function toDateTimeLocalValue(date: Date, timeZone: string): string {
  const w = toWallTime(date, timeZone);
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

/** Parse an <input type="datetime-local"> value ("YYYY-MM-DDTHH:mm[:ss]") as wall time in the given zone. */
export function fromDateTimeLocalValue(value: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  const wall = {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: m[6] ? Number(m[6]) : 0,
  };
  if (wall.month < 1 || wall.month > 12 || wall.day < 1 || wall.day > 31 || wall.hour > 23 || wall.minute > 59) {
    return null;
  }
  const date = wallTimeToUtc(wall, timeZone);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "YYYY-MM-DD" of the instant in the given zone. */
export function dateKeyInZone(date: Date, timeZone: string): string {
  const w = toWallTime(date, timeZone);
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`;
}

/** Start of the given zone-local calendar day ("YYYY-MM-DD") as an instant. */
export function startOfDayInZone(dateKey: string, timeZone: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  return wallTimeToUtc({ year: y, month: m, day: d, hour: 0, minute: 0 }, timeZone);
}

/** Start of the next zone-local calendar day after "YYYY-MM-DD". */
export function endOfDayInZone(dateKey: string, timeZone: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return wallTimeToUtc(
    { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate(), hour: 0, minute: 0 },
    timeZone,
  );
}

export function addDaysToKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${pad(next.getUTCFullYear(), 4)}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}
