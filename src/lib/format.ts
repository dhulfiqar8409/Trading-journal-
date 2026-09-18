import { toWallTime } from "@/lib/tz";

type Numberish = number | string | null | undefined;

function toNum(value: Numberish): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export interface MoneyOptions {
  currency?: string;
  /** Always show a sign, e.g. +$120.00. */
  signed?: boolean;
  /** Compact large figures (1.2M) for tiles. */
  compact?: boolean;
  fractionDigits?: number;
}

export function formatMoney(value: Numberish, options: MoneyOptions = {}): string {
  const n = toNum(value);
  if (n === null) return "—";
  const { currency = "USD", signed = false, compact = false, fractionDigits } = options;
  const useCompact = compact && Math.abs(n) >= 1_000_000;
  const digits = fractionDigits ?? (useCompact ? 1 : 2);
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    notation: useCompact ? "compact" : "standard",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: signed ? "exceptZero" : "auto",
  });
  return formatter.format(n);
}

export function formatNumber(value: Numberish, maxFractionDigits = 2, minFractionDigits = 0): string {
  const n = toNum(value);
  if (n === null) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: minFractionDigits,
    maximumFractionDigits: maxFractionDigits,
  }).format(n);
}

/** Prices keep up to 8 decimals but drop trailing zeros. */
export function formatPrice(value: Numberish): string {
  const n = toNum(value);
  if (n === null) return "—";
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : 8;
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(n);
}

export function formatPercent(ratio: Numberish, digits = 1): string {
  const n = toNum(ratio);
  if (n === null) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function formatRatio(value: Numberish, digits = 2): string {
  const n = toNum(value);
  if (n === null) return "—";
  return n.toFixed(digits);
}

export function formatR(value: Numberish): string {
  const n = toNum(value);
  if (n === null) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}R`;
}

const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(date: Date | string | null | undefined, timeZone: string): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const w = toWallTime(d, timeZone);
  return `${MONTHS[w.month - 1]} ${w.day}, ${w.year}`;
}

export function formatDateTime(date: Date | string | null | undefined, timeZone: string): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const w = toWallTime(d, timeZone);
  return `${MONTHS[w.month - 1]} ${w.day}, ${w.year} ${pad(w.hour)}:${pad(w.minute)}`;
}

export function formatShortDate(date: Date | string | null | undefined, timeZone: string): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const w = toWallTime(d, timeZone);
  return `${MONTHS[w.month - 1]} ${w.day}`;
}

export function formatDateKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function formatDuration(from: Date | string, to: Date | string | null | undefined): string {
  if (!to) return "—";
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (ms < 0) return "—";
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/** CSS class for a signed figure: profit, loss or neutral text. */
export function pnlClass(value: Numberish): string {
  const n = toNum(value);
  if (n === null || n === 0) return "text-ink-2";
  return n > 0 ? "text-profit" : "text-loss";
}
