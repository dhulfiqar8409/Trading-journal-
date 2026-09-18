/**
 * Rule-adherence statistics: weekly adherence, results split by clean vs
 * rule-breaking trades, and the cost of each broken rule.
 */
import { Decimal, toDecimalOrNull, ZERO, type DecimalInput } from "@/lib/decimal";
import type { RuleEventStatus } from "@/lib/rules";
import { isoWeekKey } from "@/lib/weeks";

export interface AdherenceEvent {
  ruleId: string;
  status: RuleEventStatus;
  justification?: string | null;
}

export interface AdherenceTrade {
  id: string;
  entryAt: Date;
  exitAt: Date | null;
  status: "OPEN" | "CLOSED";
  pnl: DecimalInput | null;
  rMultiple: DecimalInput | null;
  events: AdherenceEvent[];
}

export interface WeeklyAdherence {
  week: string;
  followed: number;
  total: number;
  /** followed / total, 0..1; null when no rule applied that week. */
  adherence: Decimal | null;
  tradeCount: number;
  cleanTrades: number;
}

export interface GroupStats {
  tradeCount: number;
  closedCount: number;
  netPnl: Decimal;
  expectancy: Decimal | null;
  winRate: Decimal | null;
  rCount: number;
  netR: Decimal;
  expectancyR: Decimal | null;
}

export interface RuleCost {
  ruleId: string;
  brokenCount: number;
  netPnl: Decimal;
  avgPnl: Decimal | null;
  netR: Decimal;
  rCount: number;
}

export function isNotFollowed(status: RuleEventStatus): boolean {
  return status !== "FOLLOWED";
}

export function hasBrokenRule(trade: Pick<AdherenceTrade, "events">): boolean {
  return trade.events.some((e) => isNotFollowed(e.status));
}

export function groupStats(trades: AdherenceTrade[]): GroupStats {
  let closedCount = 0;
  let wins = 0;
  let netPnl = ZERO;
  let netR = ZERO;
  let rCount = 0;
  for (const t of trades) {
    const pnl = t.status === "CLOSED" ? toDecimalOrNull(t.pnl) : null;
    if (!pnl) continue;
    closedCount++;
    netPnl = netPnl.plus(pnl);
    if (pnl.greaterThan(0)) wins++;
    const r = toDecimalOrNull(t.rMultiple);
    if (r) {
      netR = netR.plus(r);
      rCount++;
    }
  }
  return {
    tradeCount: trades.length,
    closedCount,
    netPnl,
    expectancy: closedCount ? netPnl.div(closedCount) : null,
    winRate: closedCount ? new Decimal(wins).div(closedCount) : null,
    rCount,
    netR,
    expectancyR: rCount ? netR.div(rCount) : null,
  };
}

/** Results of trades with every rule followed versus trades with at least one broken rule. */
export function adherenceSplit(trades: AdherenceTrade[]): { clean: GroupStats; broken: GroupStats } {
  const clean = trades.filter((t) => !hasBrokenRule(t));
  const broken = trades.filter((t) => hasBrokenRule(t));
  return { clean: groupStats(clean), broken: groupStats(broken) };
}

/** Share of rule checks that were followed, over all trades. */
export function overallAdherence(trades: AdherenceTrade[]): { followed: number; total: number; adherence: Decimal | null } {
  let followed = 0;
  let total = 0;
  for (const t of trades) {
    for (const e of t.events) {
      total++;
      if (!isNotFollowed(e.status)) followed++;
    }
  }
  return { followed, total, adherence: total ? new Decimal(followed).div(total) : null };
}

/** Adherence per ISO week of the entry date, ascending. Weeks without trades are omitted. */
export function weeklyAdherence(trades: AdherenceTrade[], timeZone: string): WeeklyAdherence[] {
  const weeks = new Map<string, WeeklyAdherence>();
  for (const t of trades) {
    const key = isoWeekKey(t.entryAt, timeZone);
    const w = weeks.get(key) ?? { week: key, followed: 0, total: 0, adherence: null, tradeCount: 0, cleanTrades: 0 };
    w.tradeCount++;
    if (!hasBrokenRule(t)) w.cleanTrades++;
    for (const e of t.events) {
      w.total++;
      if (!isNotFollowed(e.status)) w.followed++;
    }
    weeks.set(key, w);
  }
  const out = [...weeks.values()].map((w) => ({ ...w, adherence: w.total ? new Decimal(w.followed).div(w.total) : null }));
  out.sort((a, b) => a.week.localeCompare(b.week));
  return out;
}

/** P&L and R of the trades that broke each rule, most costly first. Rules never broken are omitted. */
export function ruleCosts(trades: AdherenceTrade[]): RuleCost[] {
  const costs = new Map<string, RuleCost>();
  for (const t of trades) {
    for (const e of t.events) {
      if (!isNotFollowed(e.status)) continue;
      const c = costs.get(e.ruleId) ?? { ruleId: e.ruleId, brokenCount: 0, netPnl: ZERO, avgPnl: null, netR: ZERO, rCount: 0 };
      c.brokenCount++;
      const pnl = t.status === "CLOSED" ? toDecimalOrNull(t.pnl) : null;
      if (pnl) c.netPnl = c.netPnl.plus(pnl);
      const r = toDecimalOrNull(t.rMultiple);
      if (r) {
        c.netR = c.netR.plus(r);
        c.rCount++;
      }
      costs.set(e.ruleId, c);
    }
  }
  const out = [...costs.values()].map((c) => ({ ...c, avgPnl: c.brokenCount ? c.netPnl.div(c.brokenCount) : null }));
  out.sort((a, b) => a.netPnl.comparedTo(b.netPnl) || b.brokenCount - a.brokenCount);
  return out;
}
