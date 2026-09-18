/**
 * Generic bucketing of closed trades plus the standard breakdowns: hour of
 * day, day of week, hold duration, position size, R distribution,
 * instrument, side and account.
 */
import { Decimal, toDecimal, toDecimalOrNull, ZERO, type DecimalInput } from "@/lib/decimal";
import { daysToExpiration, dteBucket } from "@/lib/options";
import { toWallTime } from "@/lib/tz";

export interface BreakdownTrade {
  id: string;
  symbol: string;
  assetClass: string;
  side: "LONG" | "SHORT";
  accountName: string;
  status: "OPEN" | "CLOSED";
  pnl: DecimalInput | null;
  rMultiple: DecimalInput | null;
  plannedRisk: DecimalInput | null;
  quantity: DecimalInput;
  entryPrice: DecimalInput;
  multiplier: DecimalInput;
  entryAt: Date;
  exitAt: Date | null;
  /** Options only. */
  optionType?: "CALL" | "PUT" | null;
  expiresAt?: Date | null;
}

export interface Bucket {
  key: string;
  label: string;
  order: number;
  tradeCount: number;
  wins: number;
  netPnl: Decimal;
  expectancy: Decimal | null;
  winRate: Decimal | null;
  netR: Decimal;
  rCount: number;
  expectancyR: Decimal | null;
}

export interface BucketKey {
  key: string;
  label: string;
  order: number;
}

export function closedOnly(trades: BreakdownTrade[]): BreakdownTrade[] {
  return trades.filter((t) => t.status === "CLOSED" && toDecimalOrNull(t.pnl) !== null);
}

export function emptyBucket(k: BucketKey): Bucket {
  return { ...k, tradeCount: 0, wins: 0, netPnl: ZERO, expectancy: null, winRate: null, netR: ZERO, rCount: 0, expectancyR: null };
}

export function addToBucket(bucket: Bucket, trade: BreakdownTrade): void {
  const pnl = toDecimal(trade.pnl as DecimalInput);
  bucket.tradeCount++;
  bucket.netPnl = bucket.netPnl.plus(pnl);
  if (pnl.greaterThan(0)) bucket.wins++;
  const r = toDecimalOrNull(trade.rMultiple);
  if (r) {
    bucket.netR = bucket.netR.plus(r);
    bucket.rCount++;
  }
}

export function finishBucket(bucket: Bucket): Bucket {
  return {
    ...bucket,
    expectancy: bucket.tradeCount ? bucket.netPnl.div(bucket.tradeCount) : null,
    winRate: bucket.tradeCount ? new Decimal(bucket.wins).div(bucket.tradeCount) : null,
    expectancyR: bucket.rCount ? bucket.netR.div(bucket.rCount) : null,
  };
}

/** Group closed trades by a key; trades the key function rejects are skipped. Buckets come back in key order. */
export function bucketBy(trades: BreakdownTrade[], keyFn: (t: BreakdownTrade) => BucketKey | null): Bucket[] {
  const buckets = new Map<string, Bucket>();
  for (const t of closedOnly(trades)) {
    const k = keyFn(t);
    if (!k) continue;
    const b = buckets.get(k.key) ?? emptyBucket(k);
    addToBucket(b, t);
    buckets.set(k.key, b);
  }
  return [...buckets.values()].map(finishBucket).sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function weekdayOf(date: Date, timeZone: string): number {
  const w = toWallTime(date, timeZone);
  return new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay();
}

export function byHourOfDay(trades: BreakdownTrade[], timeZone: string): Bucket[] {
  return bucketBy(trades, (t) => {
    const hour = toWallTime(t.entryAt, timeZone).hour;
    return { key: String(hour).padStart(2, "0"), label: `${String(hour).padStart(2, "0")}:00`, order: hour };
  });
}

export function byDayOfWeek(trades: BreakdownTrade[], timeZone: string): Bucket[] {
  return bucketBy(trades, (t) => {
    const day = weekdayOf(t.entryAt, timeZone);
    const order = (day + 6) % 7; // Monday first
    return { key: WEEKDAYS[day], label: WEEKDAYS[day], order };
  });
}

export const HOLD_BUCKETS: { label: string; maxMinutes: number }[] = [
  { label: "Under 5 min", maxMinutes: 5 },
  { label: "5–15 min", maxMinutes: 15 },
  { label: "15–60 min", maxMinutes: 60 },
  { label: "1–4 hours", maxMinutes: 240 },
  { label: "4 hours–1 day", maxMinutes: 1440 },
  { label: "Over a day", maxMinutes: Infinity },
];

export function holdMinutes(t: Pick<BreakdownTrade, "entryAt" | "exitAt">): number | null {
  if (!t.exitAt) return null;
  return Math.max(0, (t.exitAt.getTime() - t.entryAt.getTime()) / 60000);
}

export function byHoldDuration(trades: BreakdownTrade[]): Bucket[] {
  return bucketBy(trades, (t) => {
    const minutes = holdMinutes(t);
    if (minutes === null) return null;
    const index = HOLD_BUCKETS.findIndex((b) => minutes < b.maxMinutes);
    const i = index === -1 ? HOLD_BUCKETS.length - 1 : index;
    return { key: String(i), label: HOLD_BUCKETS[i].label, order: i };
  });
}

export function notional(t: Pick<BreakdownTrade, "quantity" | "entryPrice" | "multiplier">): Decimal {
  return toDecimal(t.quantity).times(toDecimal(t.entryPrice)).times(toDecimalOrNull(t.multiplier) ?? new Decimal(1));
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Small / medium / large by planned risk when stops exist, otherwise by notional value; tertile thresholds. */
export function bySizeBucket(trades: BreakdownTrade[]): { buckets: Bucket[]; basis: "risk" | "notional"; thresholds: [number, number] } {
  const closed = closedOnly(trades);
  const withRisk = closed.filter((t) => toDecimalOrNull(t.plannedRisk));
  const basis: "risk" | "notional" = withRisk.length >= Math.max(3, closed.length / 2) ? "risk" : "notional";
  const sizeOf = (t: BreakdownTrade) => (basis === "risk" ? (toDecimalOrNull(t.plannedRisk)?.toNumber() ?? null) : notional(t).toNumber());
  const sizes = closed.map(sizeOf).filter((s): s is number => s !== null).sort((a, b) => a - b);
  const t1 = quantile(sizes, 1 / 3);
  const t2 = quantile(sizes, 2 / 3);
  const buckets = bucketBy(closed, (t) => {
    const s = sizeOf(t);
    if (s === null) return null;
    if (s <= t1) return { key: "small", label: "Small", order: 0 };
    if (s <= t2) return { key: "medium", label: "Medium", order: 1 };
    return { key: "large", label: "Large", order: 2 };
  });
  return { buckets, basis, thresholds: [t1, t2] };
}

export interface HistogramBin {
  key: string;
  label: string;
  from: number | null;
  to: number | null;
  count: number;
}

export const R_BINS: { label: string; from: number | null; to: number | null }[] = [
  { label: "< -2R", from: null, to: -2 },
  { label: "-2 to -1R", from: -2, to: -1 },
  { label: "-1 to -0.5R", from: -1, to: -0.5 },
  { label: "-0.5 to 0R", from: -0.5, to: 0 },
  { label: "0 to 0.5R", from: 0, to: 0.5 },
  { label: "0.5 to 1R", from: 0.5, to: 1 },
  { label: "1 to 2R", from: 1, to: 2 },
  { label: "2 to 3R", from: 2, to: 3 },
  { label: "> 3R", from: 3, to: null },
];

/** Histogram of realised R-multiples; bins are [from, to). Trades without a stop are not counted. */
export function rDistribution(trades: BreakdownTrade[]): { bins: HistogramBin[]; total: number } {
  const bins = R_BINS.map((b, i) => ({ key: String(i), label: b.label, from: b.from, to: b.to, count: 0 }));
  let total = 0;
  for (const t of closedOnly(trades)) {
    const r = toDecimalOrNull(t.rMultiple);
    if (!r) continue;
    const v = r.toNumber();
    const bin = bins.find((b) => (b.from === null || v >= b.from) && (b.to === null || v < b.to));
    if (bin) {
      bin.count++;
      total++;
    }
  }
  return { bins, total };
}

export function byInstrument(trades: BreakdownTrade[]): Bucket[] {
  const order = ["STOCK", "OPTION", "FUTURES", "FOREX", "CRYPTO"];
  return bucketBy(trades, (t) => ({ key: t.assetClass, label: t.assetClass, order: order.indexOf(t.assetClass) }));
}

export function bySide(trades: BreakdownTrade[]): Bucket[] {
  return bucketBy(trades, (t) => ({ key: t.side, label: t.side === "LONG" ? "Long" : "Short", order: t.side === "LONG" ? 0 : 1 }));
}

export function byAccount(trades: BreakdownTrade[]): Bucket[] {
  return bucketBy(trades, (t) => ({ key: t.accountName, label: t.accountName, order: 0 }));
}

/** Calls against puts; only option trades with a known type take part. */
export function byOptionType(trades: BreakdownTrade[]): Bucket[] {
  return bucketBy(trades, (t) => {
    if (t.assetClass !== "OPTION" || !t.optionType) return null;
    return t.optionType === "CALL" ? { key: "CALL", label: "Calls", order: 0 } : { key: "PUT", label: "Puts", order: 1 };
  });
}

/** Options as a whole against shares, with everything else (futures, forex, crypto) in a third row. */
export function optionsVsShares(trades: BreakdownTrade[]): Bucket[] {
  return bucketBy(trades, (t) => {
    if (t.assetClass === "OPTION") return { key: "OPTION", label: "Options", order: 0 };
    if (t.assetClass === "STOCK") return { key: "STOCK", label: "Shares", order: 1 };
    return { key: "OTHER", label: "Other", order: 2 };
  });
}

/** Option trades by calendar days to expiration when they were entered: 0, 1 to 7, 8 to 30, 31 or more. */
export function byDaysToExpiration(trades: BreakdownTrade[], timeZone: string): Bucket[] {
  return bucketBy(trades, (t) => {
    if (t.assetClass !== "OPTION" || !t.expiresAt) return null;
    const bucket = dteBucket(daysToExpiration(t.entryAt, t.expiresAt, timeZone));
    return { key: bucket.key, label: bucket.label, order: bucket.order };
  });
}
