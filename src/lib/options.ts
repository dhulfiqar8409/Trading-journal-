/**
 * Option contracts: the calendar-day convention for expirations, the label
 * that stands in for the symbol wherever an option trade is shown
 * ("SPY 450C Sep 20"), days to expiration and the parser for contract
 * symbols found in broker files. Pure: no database, no clock beyond what the
 * caller passes in.
 */
import { Decimal, toDecimal, type DecimalInput } from "@/lib/decimal";
import { dateKeyInZone, wallTimeToUtc } from "@/lib/tz";

export const OPTION_TYPES = ["CALL", "PUT"] as const;
export type OptionType = (typeof OPTION_TYPES)[number];
/** Contract size assumed for an option trade that does not say otherwise. */
export const OPTION_MULTIPLIER = "100";
/** Wall-clock hour (owner's zone) at which an expired contract is closed out. */
export const EXPIRATION_CLOSE_HOUR = 16;

export interface OptionFields {
  optionType: OptionType | null;
  strikePrice: DecimalInput | null;
  expiresAt: Date | string | null;
}

/** Enough of a trade to label it. */
export interface OptionLike extends OptionFields {
  symbol: string;
  assetClass: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_INDEX: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n: number) => String(n).padStart(2, "0");

function validKey(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1970 || year > 2200) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * Expirations are calendar days. They are stored at 12:00 UTC so the same
 * day reads back whatever zone looks at them; null for a malformed key.
 */
export function expirationInstant(dateKey: string): Date | null {
  const m = DATE_KEY_RE.exec(dateKey.trim());
  if (!m) return null;
  const key = validKey(Number(m[1]), Number(m[2]), Number(m[3]));
  if (!key) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
}

/** "YYYY-MM-DD" of a stored expiration. */
export function expirationKey(expiresAt: Date | string): string {
  return dateKeyInZone(new Date(expiresAt), "UTC");
}

/** When an expired contract is closed out: the expiration day at 16:00 in the owner's zone. */
export function expirationCloseTime(expiresAt: Date | string, timeZone: string): Date {
  const [year, month, day] = expirationKey(expiresAt).split("-").map(Number);
  return wallTimeToUtc({ year, month, day, hour: EXPIRATION_CLOSE_HOUR, minute: 0 }, timeZone);
}

function daysBetweenKeys(from: string, to: string): number {
  const utc = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/** Calendar days from the entry day (owner's zone) to the expiration day; negative once the contract had already expired. */
export function daysToExpiration(entryAt: Date, expiresAt: Date | string, timeZone: string): number {
  return daysBetweenKeys(dateKeyInZone(entryAt, timeZone), expirationKey(expiresAt));
}

export interface DteBucket {
  key: string;
  label: string;
  order: number;
  /** Inclusive upper bound in days. */
  max: number;
}

export const DTE_BUCKETS: DteBucket[] = [
  { key: "0", label: "0 days (expiry day)", order: 0, max: 0 },
  { key: "1-7", label: "1 to 7 days", order: 1, max: 7 },
  { key: "8-30", label: "8 to 30 days", order: 2, max: 30 },
  { key: "31+", label: "31 days or more", order: 3, max: Infinity },
];

/** The bucket a number of days to expiration at entry falls in; a contract entered after expiry counts as expiry day. */
export function dteBucket(days: number): DteBucket {
  return DTE_BUCKETS.find((b) => days <= b.max) ?? DTE_BUCKETS[DTE_BUCKETS.length - 1];
}

/** A strike without trailing zeros: "450", "452.5". */
export function formatStrike(strike: DecimalInput): string {
  return toDecimal(strike).toFixed();
}

/** True when the trade is an option with a complete contract description. */
export function isOptionTrade(t: OptionLike): boolean {
  return t.assetClass === "OPTION" && t.optionType !== null && t.strikePrice !== null && t.strikePrice !== "" && t.expiresAt !== null;
}

/**
 * "SPY 450C Sep 20": underlying, strike, C or P, expiration day. The year is
 * added ("Sep 20 '24") when the contract expires in a different year than
 * `now`, so old journals stay unambiguous.
 */
export function formatOptionLabel(t: OptionLike, now: Date = new Date()): string {
  if (!isOptionTrade(t)) return t.symbol;
  const [year, month, day] = expirationKey(t.expiresAt as Date | string).split("-").map(Number);
  const suffix = year === now.getUTCFullYear() ? "" : ` '${String(year).slice(-2)}`;
  return `${t.symbol} ${formatStrike(t.strikePrice as DecimalInput)}${t.optionType === "CALL" ? "C" : "P"} ${MONTHS[month - 1]} ${day}${suffix}`;
}

/** What to show wherever a trade's symbol is shown: the contract for options, the symbol for everything else. */
export function tradeLabel(t: OptionLike, now?: Date): string {
  return isOptionTrade(t) ? formatOptionLabel(t, now) : t.symbol;
}

export interface ParsedOptionSymbol {
  underlying: string;
  /** "YYYY-MM-DD" */
  expiration: string;
  optionType: OptionType;
  strike: string;
}

function typeOf(token: string): OptionType | null {
  const t = token.toUpperCase();
  if (t === "C" || t === "CALL" || t === "CALLS") return "CALL";
  if (t === "P" || t === "PUT" || t === "PUTS") return "PUT";
  return null;
}

/** A strike token: "450", "$452.50", "450C" (with the type attached). */
function strikeOf(token: string): { strike: string; optionType: OptionType | null } | null {
  const m = /^\$?(\d+(?:\.\d+)?)(C|P|CALL|PUT)?$/i.exec(token);
  if (!m) return null;
  const strike = new Decimal(m[1]);
  if (!strike.greaterThan(0)) return null;
  return { strike: strike.toFixed(), optionType: m[2] ? typeOf(m[2]) : null };
}

function expandYear(raw: string): number {
  return raw.length === 4 ? Number(raw) : 2000 + Number(raw);
}

/** One to three tokens forming an expiration date, e.g. "09/20/2024", "20SEP24", "2024-09-20", ["SEP", "20", "2024"]. */
function dateOf(tokens: string[]): string | null {
  if (tokens.length === 1) {
    const t = tokens[0];
    let m: RegExpExecArray | null;
    if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/.exec(t))) return validKey(expandYear(m[3]), Number(m[1]), Number(m[2]));
    if ((m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(t))) return validKey(Number(m[1]), Number(m[2]), Number(m[3]));
    if ((m = /^(\d{1,2})-?([A-Z]{3,4})-?(\d{4}|\d{2})$/i.exec(t))) {
      const month = MONTH_INDEX[m[2].toLowerCase()];
      return month ? validKey(expandYear(m[3]), month, Number(m[1])) : null;
    }
    if ((m = /^([A-Z]{3,4})-?(\d{1,2})-?(\d{4}|\d{2})$/i.exec(t))) {
      const month = MONTH_INDEX[m[1].toLowerCase()];
      return month ? validKey(expandYear(m[3]), month, Number(m[2])) : null;
    }
    return null;
  }
  if (tokens.length === 3) {
    const [a, b, c] = tokens;
    if (!/^(\d{4}|\d{2})$/.test(c)) return null;
    const monthFirst = MONTH_INDEX[a.toLowerCase()];
    if (monthFirst && /^\d{1,2}$/.test(b)) return validKey(expandYear(c), monthFirst, Number(b));
    const monthSecond = MONTH_INDEX[b.toLowerCase()];
    if (monthSecond && /^\d{1,2}$/.test(a)) return validKey(expandYear(c), monthSecond, Number(a));
  }
  return null;
}

/**
 * Reads a contract out of a symbol cell: OCC/OSI ("SPY240920C00450000",
 * padded roots included), platform shorthand (".SPY240920C450") and broker
 * text ("SPY 09/20/2024 450 C", "SPY 20SEP24 450 P", "SPY SEP 20 2024 450 CALL",
 * "SPY 450C 09/20/2024"). Null when the cell is not an option.
 */
export function parseOptionSymbol(raw: string): ParsedOptionSymbol | null {
  const text = raw.trim().toUpperCase().replace(/^\./, "");
  if (!text) return null;
  let m = /^([A-Z][A-Z0-9]{0,5})\s*(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(text);
  if (m) {
    const expiration = validKey(2000 + Number(m[2]), Number(m[3]), Number(m[4]));
    const strike = new Decimal(m[6]).div(1000);
    return expiration && strike.greaterThan(0) ? { underlying: m[1], expiration, optionType: m[5] === "C" ? "CALL" : "PUT", strike: strike.toFixed() } : null;
  }
  m = /^([A-Z][A-Z0-9]{0,5})(\d{2})(\d{2})(\d{2})([CP])(\d+(?:\.\d+)?)$/.exec(text);
  if (m) {
    const expiration = validKey(2000 + Number(m[2]), Number(m[3]), Number(m[4]));
    const strike = new Decimal(m[6]);
    return expiration && strike.greaterThan(0) ? { underlying: m[1], expiration, optionType: m[5] === "C" ? "CALL" : "PUT", strike: strike.toFixed() } : null;
  }
  const tokens = text.split(/[\s_]+/).filter(Boolean);
  if (tokens.length < 3 || tokens.length > 6 || !/^[A-Z][A-Z0-9]{0,5}$/.test(tokens[0])) return null;
  const underlying = tokens[0];
  const rest = tokens.slice(1);
  // The date takes one or three tokens somewhere in the rest; what remains must be the strike and the type.
  for (const length of [1, 3]) {
    for (let start = 0; start + length <= rest.length; start++) {
      const expiration = dateOf(rest.slice(start, start + length));
      if (!expiration) continue;
      const others = [...rest.slice(0, start), ...rest.slice(start + length)];
      const contract = strikeAndType(others);
      if (contract) return { underlying, expiration, ...contract };
    }
  }
  return null;
}

/** "450 C", "C 450", "450C" or "$452.50 PUT" as strike and type; null for anything else. */
function strikeAndType(tokens: string[]): { strike: string; optionType: OptionType } | null {
  if (tokens.length === 1) {
    const s = strikeOf(tokens[0]);
    return s && s.optionType ? { strike: s.strike, optionType: s.optionType } : null;
  }
  if (tokens.length !== 2) return null;
  for (const [a, b] of [
    [tokens[0], tokens[1]],
    [tokens[1], tokens[0]],
  ]) {
    const s = strikeOf(a);
    const type = typeOf(b);
    if (s && !s.optionType && type) return { strike: s.strike, optionType: type };
  }
  return null;
}
