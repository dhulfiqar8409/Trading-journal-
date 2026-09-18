/**
 * Tolerant date parsing for CSV imports. Understands ISO 8601, "YYYY-MM-DD
 * HH:mm[:ss]", US "M/D/YYYY[ h:mm[:ss][ AM|PM]]", day-first variants,
 * "12 Mar 2024", "Mar 12, 2024" and Unix timestamps. Values without an
 * explicit offset are interpreted in `timeZone` (UTC by default).
 */

import { wallTimeToUtc } from "@/lib/tz";

export interface ParseDateOptions {
  /** Interpret ambiguous numeric dates as day/month/year instead of month/day/year. */
  dayFirst?: boolean;
  /** Zone for values without an explicit offset. Defaults to UTC. */
  timeZone?: string;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

interface Pieces {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  offsetMinutes: number | null;
}

const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?\s*(am|pm|a\.m\.|p\.m\.)?$/i;
const NAMED_ZONE_RE = /\s*(z|utc|gmt)$/i;
// A numeric offset only counts as a zone when it directly follows a time, so
// that "3-12-2024" is not read as 3-12 with a -20:24 offset.
const OFFSET_RE = /(\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d{1,9})?)?\s*(?:am|pm|a\.m\.|p\.m\.)?)\s*([+-]\d{2}:?\d{2})$/i;

function parseZone(text: string): { rest: string; offsetMinutes: number | null } {
  const trimmed = text.trim();
  const named = NAMED_ZONE_RE.exec(trimmed);
  if (named) {
    return { rest: trimmed.slice(0, named.index).trim(), offsetMinutes: 0 };
  }
  const numeric = OFFSET_RE.exec(trimmed);
  if (!numeric) return { rest: trimmed, offsetMinutes: null };
  const rest = trimmed.slice(0, numeric.index + numeric[1].length).trim();
  const zone = numeric[2];
  const sign = zone.startsWith("-") ? -1 : 1;
  const digits = zone.slice(1).replace(":", "");
  const offset = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
  return { rest, offsetMinutes: offset };
}

function parseTime(text: string): Pick<Pieces, "hour" | "minute" | "second" | "millisecond"> | null {
  const m = TIME_RE.exec(text.trim());
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const second = m[3] ? Number(m[3]) : 0;
  const millisecond = m[4] ? Math.round(Number(`0.${m[4]}`) * 1000) : 0;
  const meridiem = m[5]?.toLowerCase().replace(/\./g, "");
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  }
  if (hour > 23 || minute > 59 || second > 60) return null;
  return { hour, minute, second, millisecond };
}

function expandYear(raw: string): number {
  const n = Number(raw);
  if (raw.length === 4) return n;
  return n < 70 ? 2000 + n : 1900 + n;
}

function validDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

function splitDateAndTime(text: string): { datePart: string; timePart: string | null } {
  const t = text.trim().replace(/,\s*(\d{1,2}:)/, " $1");
  const m = /^(.*?)(?:[T\s]+(\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d{1,9})?)?\s*(?:am|pm|a\.m\.|p\.m\.)?))?$/i.exec(t);
  if (!m) return { datePart: t, timePart: null };
  return { datePart: m[1].trim(), timePart: m[2] ? m[2].trim() : null };
}

function parseDatePart(text: string, dayFirst: boolean): { year: number; month: number; day: number } | null {
  let m: RegExpExecArray | null;

  // 2024-03-12, 2024/03/12, 2024.03.12, 20240312
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text))) {
    return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  }
  if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(text))) {
    return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  }
  // 03/12/2024, 3-12-24, 12.03.2024 (dots imply day-first)
  if ((m = /^(\d{1,2})([-/.])(\d{1,2})\2(\d{2}|\d{4})$/.exec(text))) {
    const a = Number(m[1]);
    const b = Number(m[3]);
    const year = expandYear(m[4]);
    const preferDayFirst = dayFirst || m[2] === ".";
    let month: number;
    let day: number;
    if (preferDayFirst) {
      [day, month] = [a, b];
    } else {
      [month, day] = [a, b];
    }
    // Disambiguate when the chosen order is impossible (e.g. 25/03/2024 with month-first).
    if (month > 12 && day <= 12) [month, day] = [day, month];
    return { year, month, day };
  }
  // 12 Mar 2024, 12-Mar-2024, 12 March 2024
  if ((m = /^(\d{1,2})[\s-]+([a-z]{3,9})\.?[\s-]+(\d{2}|\d{4})$/i.exec(text))) {
    const month = MONTHS[m[2].toLowerCase()];
    if (!month) return null;
    return { year: expandYear(m[3]), month, day: Number(m[1]) };
  }
  // Mar 12, 2024 / March 12 2024
  if ((m = /^([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{2}|\d{4})$/i.exec(text))) {
    const month = MONTHS[m[1].toLowerCase()];
    if (!month) return null;
    return { year: expandYear(m[3]), month, day: Number(m[2]) };
  }
  return null;
}

export function parseFlexibleDate(input: string, options: ParseDateOptions = {}): Date | null {
  const raw = input.trim();
  if (!raw) return null;
  const timeZone = options.timeZone ?? "UTC";

  // Unix timestamps in seconds or milliseconds.
  if (/^\d{10}$/.test(raw)) return new Date(Number(raw) * 1000);
  if (/^\d{13}$/.test(raw)) return new Date(Number(raw));

  const { rest, offsetMinutes } = parseZone(raw);
  const { datePart, timePart } = splitDateAndTime(rest);
  const ymd = parseDatePart(datePart, options.dayFirst ?? false);
  if (!ymd || !validDate(ymd.year, ymd.month, ymd.day)) return null;
  const time = timePart ? parseTime(timePart) : { hour: 0, minute: 0, second: 0, millisecond: 0 };
  if (!time) return null;

  if (offsetMinutes !== null) {
    const utc = Date.UTC(ymd.year, ymd.month - 1, ymd.day, time.hour, time.minute, time.second, time.millisecond);
    return new Date(utc - offsetMinutes * 60000);
  }
  const date = wallTimeToUtc(
    { year: ymd.year, month: ymd.month, day: ymd.day, hour: time.hour, minute: time.minute, second: time.second },
    timeZone,
  );
  return new Date(date.getTime() + time.millisecond);
}
