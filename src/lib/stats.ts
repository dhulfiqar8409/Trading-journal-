import { Decimal, toDecimal, ZERO, type DecimalInput } from "@/lib/decimal";
import { dateKeyInZone } from "@/lib/tz";

export interface StatsTrade {
  id: string;
  symbol: string;
  status: "OPEN" | "CLOSED";
  pnl: DecimalInput | null;
  entryAt: Date;
  exitAt: Date | null;
  tags?: string[];
  /** Realised R-multiple; null for trades without a stop (excluded from R statistics). */
  rMultiple?: DecimalInput | null;
}

export interface ClosedTrade {
  id: string;
  symbol: string;
  pnl: Decimal;
  rMultiple: Decimal | null;
  entryAt: Date;
  exitAt: Date;
  tags: string[];
}

export interface Streak {
  kind: "WIN" | "LOSS" | "NONE";
  length: number;
}

export interface Summary {
  tradeCount: number;
  openCount: number;
  wins: number;
  losses: number;
  breakeven: number;
  netPnl: Decimal;
  grossProfit: Decimal;
  /** Sum of losing trades' P&L (zero or negative). */
  grossLoss: Decimal;
  /** wins / closed trades, 0..1. Null with no closed trades. */
  winRate: Decimal | null;
  /** grossProfit / |grossLoss|. Null when there are no losses. */
  profitFactor: Decimal | null;
  avgWin: Decimal | null;
  /** Average of losing trades (negative). */
  avgLoss: Decimal | null;
  /** Net P&L per closed trade. */
  expectancy: Decimal | null;
  largestWin: Decimal | null;
  largestLoss: Decimal | null;
  /** Largest peak-to-trough decline of cumulative P&L (zero or positive). */
  maxDrawdown: Decimal;
  streak: Streak;
  /** R-based figures over the closed trades that have a stop. */
  rTradeCount: number;
  netR: Decimal;
  expectancyR: Decimal | null;
  avgWinR: Decimal | null;
  avgLossR: Decimal | null;
  maxDrawdownR: Decimal;
}

export interface Breakdown {
  key: string;
  tradeCount: number;
  wins: number;
  losses: number;
  netPnl: Decimal;
  winRate: Decimal;
  netR: Decimal;
  rTradeCount: number;
}

export interface DailyPoint {
  /** "YYYY-MM-DD" in the requested zone. */
  date: string;
  pnl: Decimal;
  r: Decimal;
  tradeCount: number;
}

export interface EquityPoint {
  tradeId: string;
  exitAt: Date;
  pnl: Decimal;
  cumulative: Decimal;
  r: Decimal | null;
  cumulativeR: Decimal;
}

/** Closed trades with a P&L, in chronological exit order. Open trades are excluded from every statistic. */
export function closedTrades(trades: StatsTrade[]): ClosedTrade[] {
  const closed: ClosedTrade[] = [];
  for (const t of trades) {
    if (t.status !== "CLOSED" || t.pnl === null || t.pnl === undefined || !t.exitAt) continue;
    closed.push({
      id: t.id,
      symbol: t.symbol,
      pnl: toDecimal(t.pnl),
      rMultiple: t.rMultiple === null || t.rMultiple === undefined ? null : toDecimal(t.rMultiple),
      entryAt: t.entryAt,
      exitAt: t.exitAt,
      tags: t.tags ?? [],
    });
  }
  closed.sort((a, b) => a.exitAt.getTime() - b.exitAt.getTime() || a.id.localeCompare(b.id));
  return closed;
}

/** Max drawdown of a chronological P&L sequence, measured from a starting equity of zero. */
export function maxDrawdown(pnls: DecimalInput[]): Decimal {
  let peak = ZERO;
  let cumulative = ZERO;
  let worst = ZERO;
  for (const p of pnls) {
    cumulative = cumulative.plus(toDecimal(p));
    if (cumulative.greaterThan(peak)) peak = cumulative;
    const drawdown = peak.minus(cumulative);
    if (drawdown.greaterThan(worst)) worst = drawdown;
  }
  return worst;
}

/** Current run of consecutive wins or losses, counted back from the most recent closed trade. */
export function currentStreak(closed: ClosedTrade[]): Streak {
  if (closed.length === 0) return { kind: "NONE", length: 0 };
  const last = closed[closed.length - 1].pnl;
  if (last.isZero()) return { kind: "NONE", length: 0 };
  const kind = last.greaterThan(0) ? "WIN" : "LOSS";
  let length = 0;
  for (let i = closed.length - 1; i >= 0; i--) {
    const p = closed[i].pnl;
    const sameKind = kind === "WIN" ? p.greaterThan(0) : p.lessThan(0);
    if (!sameKind) break;
    length++;
  }
  return { kind, length };
}

export function summarize(trades: StatsTrade[]): Summary {
  const closed = closedTrades(trades);
  const openCount = trades.filter((t) => t.status === "OPEN").length;
  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let grossProfit = ZERO;
  let grossLoss = ZERO;
  let largestWin: Decimal | null = null;
  let largestLoss: Decimal | null = null;

  for (const t of closed) {
    if (t.pnl.greaterThan(0)) {
      wins++;
      grossProfit = grossProfit.plus(t.pnl);
      if (!largestWin || t.pnl.greaterThan(largestWin)) largestWin = t.pnl;
    } else if (t.pnl.lessThan(0)) {
      losses++;
      grossLoss = grossLoss.plus(t.pnl);
      if (!largestLoss || t.pnl.lessThan(largestLoss)) largestLoss = t.pnl;
    } else {
      breakeven++;
    }
  }

  let rTradeCount = 0;
  let rWins = 0;
  let rLosses = 0;
  let netR = ZERO;
  let grossWinR = ZERO;
  let grossLossR = ZERO;
  const rSeries: Decimal[] = [];
  for (const t of closed) {
    if (!t.rMultiple) continue;
    rTradeCount++;
    netR = netR.plus(t.rMultiple);
    rSeries.push(t.rMultiple);
    if (t.rMultiple.greaterThan(0)) {
      rWins++;
      grossWinR = grossWinR.plus(t.rMultiple);
    } else if (t.rMultiple.lessThan(0)) {
      rLosses++;
      grossLossR = grossLossR.plus(t.rMultiple);
    }
  }

  const tradeCount = closed.length;
  const netPnl = grossProfit.plus(grossLoss);
  return {
    tradeCount,
    openCount,
    wins,
    losses,
    breakeven,
    netPnl,
    grossProfit,
    grossLoss,
    winRate: tradeCount ? new Decimal(wins).div(tradeCount) : null,
    profitFactor: grossLoss.isZero() ? null : grossProfit.div(grossLoss.abs()),
    avgWin: wins ? grossProfit.div(wins) : null,
    avgLoss: losses ? grossLoss.div(losses) : null,
    expectancy: tradeCount ? netPnl.div(tradeCount) : null,
    largestWin,
    largestLoss,
    maxDrawdown: maxDrawdown(closed.map((t) => t.pnl)),
    streak: currentStreak(closed),
    rTradeCount,
    netR,
    expectancyR: rTradeCount ? netR.div(rTradeCount) : null,
    avgWinR: rWins ? grossWinR.div(rWins) : null,
    avgLossR: rLosses ? grossLossR.div(rLosses) : null,
    maxDrawdownR: maxDrawdown(rSeries),
  };
}

function buildBreakdown(groups: Map<string, ClosedTrade[]>): Breakdown[] {
  const rows: Breakdown[] = [];
  for (const [key, list] of groups) {
    const wins = list.filter((t) => t.pnl.greaterThan(0)).length;
    const losses = list.filter((t) => t.pnl.lessThan(0)).length;
    const netPnl = list.reduce((acc, t) => acc.plus(t.pnl), ZERO);
    const withR = list.filter((t) => t.rMultiple);
    const netR = withR.reduce((acc, t) => acc.plus(t.rMultiple as Decimal), ZERO);
    rows.push({ key, tradeCount: list.length, wins, losses, netPnl, winRate: new Decimal(wins).div(list.length), netR, rTradeCount: withR.length });
  }
  rows.sort((a, b) => b.netPnl.comparedTo(a.netPnl) || a.key.localeCompare(b.key));
  return rows;
}

export function breakdownBySymbol(trades: StatsTrade[]): Breakdown[] {
  const groups = new Map<string, ClosedTrade[]>();
  for (const t of closedTrades(trades)) {
    const list = groups.get(t.symbol) ?? [];
    list.push(t);
    groups.set(t.symbol, list);
  }
  return buildBreakdown(groups);
}

/** One row per tag; a trade with several tags counts towards each of them. Untagged trades are omitted. */
export function breakdownByTag(trades: StatsTrade[]): Breakdown[] {
  const groups = new Map<string, ClosedTrade[]>();
  for (const t of closedTrades(trades)) {
    for (const tag of new Set(t.tags)) {
      const list = groups.get(tag) ?? [];
      list.push(t);
      groups.set(tag, list);
    }
  }
  return buildBreakdown(groups);
}

/** Net P&L per calendar day (by exit time) in the given zone, ascending. Days without trades are omitted. */
export function dailyPnl(trades: StatsTrade[], options: { timeZone?: string } = {}): DailyPoint[] {
  const timeZone = options.timeZone ?? "UTC";
  const days = new Map<string, DailyPoint>();
  for (const t of closedTrades(trades)) {
    const key = dateKeyInZone(t.exitAt, timeZone);
    const day = days.get(key) ?? { date: key, pnl: ZERO, r: ZERO, tradeCount: 0 };
    day.pnl = day.pnl.plus(t.pnl);
    if (t.rMultiple) day.r = day.r.plus(t.rMultiple);
    day.tradeCount++;
    days.set(key, day);
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Cumulative net P&L after each closed trade, in exit order. */
export function equityCurve(trades: StatsTrade[]): EquityPoint[] {
  let cumulative = ZERO;
  let cumulativeR = ZERO;
  return closedTrades(trades).map((t) => {
    cumulative = cumulative.plus(t.pnl);
    if (t.rMultiple) cumulativeR = cumulativeR.plus(t.rMultiple);
    return { tradeId: t.id, exitAt: t.exitAt, pnl: t.pnl, cumulative, r: t.rMultiple, cumulativeR };
  });
}
