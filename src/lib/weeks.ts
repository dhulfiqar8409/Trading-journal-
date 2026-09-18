/**
 * ISO-8601 week helpers. Weeks run Monday to Sunday and are computed from the
 * calendar date in the owner's zone, so a trade closed late on Sunday evening
 * in New York belongs to that week even though it is already Monday in UTC.
 */
import { dateKeyInZone, endOfDayInZone, startOfDayInZone } from "@/lib/tz";

export interface IsoWeek {
  isoYear: number;
  week: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** ISO week of a calendar date (year, month 1-12, day). */
export function isoWeekOf(year: number, month: number, day: number): IsoWeek {
  const d = new Date(Date.UTC(year, month - 1, day));
  const weekday = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - weekday + 3); // Thursday of this week decides the year
  const isoYear = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstWeekday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstWeekday + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
  return { isoYear, week };
}

export function formatIsoWeekKey(week: IsoWeek): string {
  return `${pad(week.isoYear, 4)}-W${pad(week.week)}`;
}

/** "YYYY-Www" for the calendar day that contains the instant in the given zone. */
export function isoWeekKey(date: Date, timeZone: string): string {
  const [y, m, d] = dateKeyInZone(date, timeZone).split("-").map(Number);
  return formatIsoWeekKey(isoWeekOf(y, m, d));
}

export function isoWeekKeyOfDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return formatIsoWeekKey(isoWeekOf(y, m, d));
}

export function parseIsoWeekKey(key: string): IsoWeek | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(key.trim());
  if (!m) return null;
  const isoYear = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) return null;
  // Week 53 only exists in long years.
  if (week === 53 && isoWeekOf(isoYear, 12, 28).week !== 53) return null;
  return { isoYear, week };
}

/** Monday of the given ISO week as a UTC calendar date. */
function mondayOf(week: IsoWeek): Date {
  const jan4 = new Date(Date.UTC(week.isoYear, 0, 4));
  const jan4Weekday = (jan4.getUTCDay() + 6) % 7;
  const monday = new Date(jan4.getTime() - jan4Weekday * DAY_MS);
  monday.setUTCDate(monday.getUTCDate() + (week.week - 1) * 7);
  return monday;
}

function keyOfUtcDate(d: Date): string {
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** The seven "YYYY-MM-DD" keys of a week, Monday first. */
export function dayKeysOfIsoWeek(key: string): string[] {
  const week = parseIsoWeekKey(key);
  if (!week) return [];
  const monday = mondayOf(week);
  return Array.from({ length: 7 }, (_, i) => keyOfUtcDate(new Date(monday.getTime() + i * DAY_MS)));
}

/** Instants bounding the week in the owner's zone: [from, to). */
export function isoWeekRange(key: string, timeZone: string): { from: Date; to: Date; fromKey: string; toKey: string } | null {
  const days = dayKeysOfIsoWeek(key);
  if (days.length === 0) return null;
  return { from: startOfDayInZone(days[0], timeZone), to: endOfDayInZone(days[6], timeZone), fromKey: days[0], toKey: days[6] };
}

export function shiftIsoWeek(key: string, delta: number): string | null {
  const week = parseIsoWeekKey(key);
  if (!week) return null;
  const monday = mondayOf(week);
  const shifted = new Date(monday.getTime() + delta * 7 * DAY_MS);
  return formatIsoWeekKey(isoWeekOf(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate()));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sep 14 – Sep 20, 2026". */
export function isoWeekLabel(key: string): string {
  const days = dayKeysOfIsoWeek(key);
  if (days.length === 0) return key;
  const [y1, m1, d1] = days[0].split("-").map(Number);
  const [y2, m2, d2] = days[6].split("-").map(Number);
  const left = `${MONTHS[m1 - 1]} ${d1}${y1 !== y2 ? `, ${y1}` : ""}`;
  return `${left} – ${MONTHS[m2 - 1]} ${d2}, ${y2}`;
}
