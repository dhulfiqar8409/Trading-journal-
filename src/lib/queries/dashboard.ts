import "server-only";
import { threeCurves } from "@/lib/curves";
import { db } from "@/lib/db";
import { toNumber, toPlainString } from "@/lib/decimal";
import { edgeScore, edgeScoreTrend } from "@/lib/edge-score";
import { mistakeCosts } from "@/lib/mistakes";
import { tradeLabel } from "@/lib/options";
import { serializeTrade, type TradeDTO } from "@/lib/serialize";
import {
  breakdownBySymbol,
  breakdownByTag,
  dailyPnl,
  equityCurve,
  summarize,
  type Breakdown,
  type StatsTrade,
  type Summary,
} from "@/lib/stats";
import { addDaysToKey, dateKeyInZone, endOfDayInZone, startOfDayInZone } from "@/lib/tz";

export const RANGE_KEYS = ["7d", "30d", "90d", "ytd", "all", "custom"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];

export interface ResolvedRange {
  key: RangeKey;
  fromKey: string | null;
  toKey: string | null;
  from: Date | null;
  /** Exclusive upper bound. */
  to: Date | null;
  label: string;
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function resolveRange(
  params: { range?: string; from?: string; to?: string },
  timeZone: string,
  now: Date = new Date(),
): ResolvedRange {
  const today = dateKeyInZone(now, timeZone);
  const key: RangeKey = (RANGE_KEYS as readonly string[]).includes(params.range ?? "") ? (params.range as RangeKey) : "30d";
  const bounded = (fromKey: string, toKey: string, label: string): ResolvedRange => ({
    key,
    fromKey,
    toKey,
    from: startOfDayInZone(fromKey, timeZone),
    to: endOfDayInZone(toKey, timeZone),
    label,
  });
  switch (key) {
    case "7d":
      return bounded(addDaysToKey(today, -6), today, "Last 7 days");
    case "90d":
      return bounded(addDaysToKey(today, -89), today, "Last 90 days");
    case "ytd":
      return bounded(`${today.slice(0, 4)}-01-01`, today, "Year to date");
    case "all":
      return { key, fromKey: null, toKey: null, from: null, to: null, label: "All time" };
    case "custom": {
      const fromKey = params.from && DATE_KEY_RE.test(params.from) ? params.from : addDaysToKey(today, -29);
      const toKey = params.to && DATE_KEY_RE.test(params.to) ? params.to : today;
      const [lo, hi] = fromKey <= toKey ? [fromKey, toKey] : [toKey, fromKey];
      return bounded(lo, hi, `${lo} to ${hi}`);
    }
    case "30d":
    default:
      return bounded(addDaysToKey(today, -29), today, "Last 30 days");
  }
}

export interface SummaryDTO {
  tradeCount: number;
  openCount: number;
  wins: number;
  losses: number;
  breakeven: number;
  netPnl: number;
  grossProfit: number;
  grossLoss: number;
  winRate: number | null;
  profitFactor: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  expectancy: number | null;
  largestWin: number | null;
  largestLoss: number | null;
  maxDrawdown: number;
  streak: Summary["streak"];
  rTradeCount: number;
  netR: number;
  expectancyR: number | null;
  avgWinR: number | null;
  avgLossR: number | null;
  maxDrawdownR: number;
}

export interface BreakdownDTO {
  key: string;
  tradeCount: number;
  wins: number;
  losses: number;
  netPnl: number;
  winRate: number;
  netR: number;
  rTradeCount: number;
}

export interface EquityPointDTO {
  t: number;
  tradeId: string;
  symbol: string;
  pnl: number;
  cumulative: number;
  r: number | null;
  cumulativeR: number;
}

export interface DailyPointDTO {
  date: string;
  pnl: number;
  r: number;
  tradeCount: number;
}

export interface EdgeScoreDTO {
  score: number | null;
  factors: { key: string; label: string; raw: number | null; score: number }[];
  sampleSize: number;
  window: number;
  minimum: number;
  insufficient: boolean;
  trend: { index: number; t: number; score: number }[];
}

export interface CurvePointDTO {
  t: number;
  tradeId: string;
  symbol: string;
  actual: number;
  mistakesRemoved: number;
  stopsHonoured: number;
  actualR: number;
  mistakesRemovedR: number;
  stopsHonouredR: number;
  removed: boolean;
  capped: boolean;
}

export interface CurvesDTO {
  points: CurvePointDTO[];
  actual: number;
  mistakesRemoved: number;
  stopsHonoured: number;
  actualR: number;
  mistakesRemovedR: number;
  stopsHonouredR: number;
  removedCount: number;
  cappedCount: number;
}

export interface MistakeCostDTO {
  tagId: string;
  name: string;
  count: number;
  netPnl: number;
  avgPnl: number | null;
  netR: number;
  rCount: number;
}

export interface CalendarDTO {
  month: string;
  prevMonth: string;
  nextMonth: string;
  days: DailyPointDTO[];
  monthPnl: number;
  tradeCount: number;
}

export interface DashboardData {
  range: ResolvedRange;
  currency: string;
  summary: SummaryDTO;
  equity: EquityPointDTO[];
  daily: DailyPointDTO[];
  calendar: CalendarDTO;
  topSymbols: BreakdownDTO[];
  byTag: BreakdownDTO[];
  recent: TradeDTO[];
  edge: EdgeScoreDTO;
  curves: CurvesDTO;
  mistakes: MistakeCostDTO[];
}

function serializeSummary(s: Summary): SummaryDTO {
  return {
    tradeCount: s.tradeCount,
    openCount: s.openCount,
    wins: s.wins,
    losses: s.losses,
    breakeven: s.breakeven,
    netPnl: s.netPnl.toNumber(),
    grossProfit: s.grossProfit.toNumber(),
    grossLoss: s.grossLoss.toNumber(),
    winRate: toNumber(s.winRate),
    profitFactor: toNumber(s.profitFactor),
    avgWin: toNumber(s.avgWin),
    avgLoss: toNumber(s.avgLoss),
    expectancy: toNumber(s.expectancy),
    largestWin: toNumber(s.largestWin),
    largestLoss: toNumber(s.largestLoss),
    maxDrawdown: s.maxDrawdown.toNumber(),
    streak: s.streak,
    rTradeCount: s.rTradeCount,
    netR: s.netR.toNumber(),
    expectancyR: toNumber(s.expectancyR),
    avgWinR: toNumber(s.avgWinR),
    avgLossR: toNumber(s.avgLossR),
    maxDrawdownR: s.maxDrawdownR.toNumber(),
  };
}

function serializeBreakdown(b: Breakdown): BreakdownDTO {
  return {
    key: b.key,
    tradeCount: b.tradeCount,
    wins: b.wins,
    losses: b.losses,
    netPnl: b.netPnl.toNumber(),
    winRate: b.winRate.toNumber(),
    netR: b.netR.toNumber(),
    rTradeCount: b.rTradeCount,
  };
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function resolveMonth(param: string | undefined, range: ResolvedRange, timeZone: string, now: Date = new Date()): string {
  if (param && /^\d{4}-(0[1-9]|1[0-2])$/.test(param)) return param;
  const anchor = range.toKey ?? dateKeyInZone(now, timeZone);
  return anchor.slice(0, 7);
}

export async function loadDashboard(userId: string, timeZone: string, range: ResolvedRange, month: string): Promise<DashboardData> {
  const exitFilter = range.from && range.to ? { gte: range.from, lt: range.to } : undefined;
  const monthStart = startOfDayInZone(`${month}-01`, timeZone);
  const monthEnd = startOfDayInZone(`${shiftMonth(month, 1)}-01`, timeZone);

  const [closed, openCount, monthTrades, recent, defaultAccount, history] = await Promise.all([
    db.trade.findMany({
      where: { userId, status: "CLOSED", ...(exitFilter ? { exitAt: exitFilter } : {}) },
      select: {
        id: true,
        symbol: true,
        assetClass: true,
        optionType: true,
        strikePrice: true,
        expiresAt: true,
        status: true,
        pnl: true,
        rMultiple: true,
        plannedRisk: true,
        entryAt: true,
        exitAt: true,
        tags: { select: { id: true, name: true, kind: true } },
      },
      orderBy: { exitAt: "asc" },
    }),
    db.trade.count({ where: { userId, status: "OPEN" } }),
    db.trade.findMany({
      where: { userId, status: "CLOSED", exitAt: { gte: monthStart, lt: monthEnd } },
      select: { id: true, symbol: true, status: true, pnl: true, entryAt: true, exitAt: true },
    }),
    db.trade.findMany({
      where: { userId },
      orderBy: [{ entryAt: "desc" }, { createdAt: "desc" }],
      take: 8,
      include: { account: { select: { id: true, name: true, currency: true } }, tags: { orderBy: { name: "asc" } } },
    }),
    db.account.findFirst({ where: { userId }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], select: { currency: true } }),
    db.trade.findMany({
      where: { userId, status: "CLOSED", exitAt: { not: null } },
      select: { id: true, exitAt: true, pnl: true },
      orderBy: { exitAt: "asc" },
    }),
  ]);

  const statsTrades: StatsTrade[] = closed.map((t) => ({
    id: t.id,
    symbol: t.symbol,
    status: t.status,
    pnl: t.pnl,
    rMultiple: t.rMultiple,
    entryAt: t.entryAt,
    exitAt: t.exitAt,
    tags: t.tags.map((tag) => tag.name),
  }));
  const scoreTrades = history.filter((t) => t.exitAt && t.pnl !== null).map((t) => ({ id: t.id, exitAt: t.exitAt as Date, pnl: toPlainString(t.pnl) as string }));
  const edge = edgeScore(scoreTrades, { timeZone });
  const trend = edgeScoreTrend(scoreTrades, { timeZone });
  const curves = threeCurves(
    closed.map((t) => ({
      id: t.id,
      symbol: tradeLabel(t),
      status: t.status,
      exitAt: t.exitAt,
      pnl: toPlainString(t.pnl),
      rMultiple: toPlainString(t.rMultiple),
      plannedRisk: toPlainString(t.plannedRisk),
      hasMistake: t.tags.some((tag) => tag.kind === "MISTAKE"),
    })),
  );
  const mistakes = mistakeCosts(
    closed.map((t) => ({ id: t.id, status: t.status, pnl: toPlainString(t.pnl), rMultiple: toPlainString(t.rMultiple), tags: t.tags })),
  );
  const summary = summarize(statsTrades);
  summary.openCount = openCount;
  // Option trades are labelled by their contract in tooltips and tables; the top-symbols table groups them by underlying.
  const symbols = new Map(closed.map((t) => [t.id, tradeLabel(t)]));

  const monthDays = dailyPnl(
    monthTrades.map((t) => ({ id: t.id, symbol: t.symbol, status: t.status, pnl: t.pnl, entryAt: t.entryAt, exitAt: t.exitAt })),
    { timeZone },
  ).map((d) => ({ date: d.date, pnl: d.pnl.toNumber(), r: d.r.toNumber(), tradeCount: d.tradeCount }));

  return {
    range,
    currency: defaultAccount?.currency ?? "USD",
    summary: serializeSummary(summary),
    equity: equityCurve(statsTrades).map((p) => ({
      t: p.exitAt.getTime(),
      tradeId: p.tradeId,
      symbol: symbols.get(p.tradeId) ?? "",
      pnl: p.pnl.toNumber(),
      cumulative: p.cumulative.toNumber(),
      r: toNumber(p.r),
      cumulativeR: p.cumulativeR.toNumber(),
    })),
    daily: dailyPnl(statsTrades, { timeZone }).map((d) => ({ date: d.date, pnl: d.pnl.toNumber(), r: d.r.toNumber(), tradeCount: d.tradeCount })),
    calendar: {
      month,
      prevMonth: shiftMonth(month, -1),
      nextMonth: shiftMonth(month, 1),
      days: monthDays,
      monthPnl: monthDays.reduce((acc, d) => acc + d.pnl, 0),
      tradeCount: monthDays.reduce((acc, d) => acc + d.tradeCount, 0),
    },
    topSymbols: breakdownBySymbol(statsTrades).slice(0, 8).map(serializeBreakdown),
    byTag: breakdownByTag(statsTrades).map(serializeBreakdown),
    recent: recent.map(serializeTrade),
    edge: {
      score: edge.score,
      factors: edge.factors,
      sampleSize: edge.sampleSize,
      window: edge.window,
      minimum: edge.minimum,
      insufficient: edge.insufficient,
      trend,
    },
    curves: {
      points: curves.points.map((p) => ({
        t: p.t,
        tradeId: p.tradeId,
        symbol: p.symbol,
        actual: p.actual.toNumber(),
        mistakesRemoved: p.mistakesRemoved.toNumber(),
        stopsHonoured: p.stopsHonoured.toNumber(),
        actualR: p.actualR.toNumber(),
        mistakesRemovedR: p.mistakesRemovedR.toNumber(),
        stopsHonouredR: p.stopsHonouredR.toNumber(),
        removed: p.removed,
        capped: p.capped,
      })),
      actual: curves.actual.toNumber(),
      mistakesRemoved: curves.mistakesRemoved.toNumber(),
      stopsHonoured: curves.stopsHonoured.toNumber(),
      actualR: curves.actualR.toNumber(),
      mistakesRemovedR: curves.mistakesRemovedR.toNumber(),
      stopsHonouredR: curves.stopsHonouredR.toNumber(),
      removedCount: curves.removedCount,
      cappedCount: curves.cappedCount,
    },
    mistakes: mistakes.map((m) => ({
      tagId: m.tagId,
      name: m.name,
      count: m.count,
      netPnl: m.netPnl.toNumber(),
      avgPnl: toNumber(m.avgPnl),
      netR: m.netR.toNumber(),
      rCount: m.rCount,
    })),
  };
}
