/**
 * Leak finder: deterministic checks over logged trades. Each finding
 * compares a subgroup against the rest, reports the money and R it cost
 * (negative) or left on the table (positive), and suggests a matching rule.
 */
import { Decimal, toDecimal, toDecimalOrNull, ZERO, type DecimalInput } from "@/lib/decimal";
import { byDayOfWeek, byHourOfDay, closedOnly, holdMinutes, type BreakdownTrade, type Bucket } from "@/lib/breakdowns";
import type { RuleKind } from "@/lib/rules";
import { dateKeyInZone, toWallTime } from "@/lib/tz";

export interface LeakTrade extends BreakdownTrade {
  setupIds: string[];
}

export interface LeakContext {
  timeZone: string;
  /** Planned trade caps per day, when the owner checked in. */
  plans: { date: string; maxTrades: number | null }[];
  setups: { id: string; name: string }[];
}

export interface SuggestedRule {
  kind: RuleKind;
  title: string;
  value?: string;
  timeValue?: string;
}

export interface Finding {
  key: string;
  title: string;
  description: string;
  sampleSize: number;
  /** Cost (negative) or opportunity (positive) in currency. */
  impactPnl: Decimal;
  /** Same in R, when the trades involved have stops. */
  impactR: Decimal | null;
  groupExpectancy: Decimal;
  restExpectancy: Decimal | null;
  suggestedRule: SuggestedRule | null;
  kind: "leak" | "opportunity";
}

export interface LeakOptions {
  revengeMinutes?: number;
  minSample?: number;
}

interface Group {
  trades: LeakTrade[];
  rest: LeakTrade[];
}

function stats(trades: BreakdownTrade[]): { count: number; net: Decimal; expectancy: Decimal | null; netR: Decimal; rCount: number; expectancyR: Decimal | null } {
  let net = ZERO;
  let netR = ZERO;
  let rCount = 0;
  for (const t of trades) {
    net = net.plus(toDecimal(t.pnl as DecimalInput));
    const r = toDecimalOrNull(t.rMultiple);
    if (r) {
      netR = netR.plus(r);
      rCount++;
    }
  }
  const count = trades.length;
  return { count, net, expectancy: count ? net.div(count) : null, netR, rCount, expectancyR: rCount ? netR.div(rCount) : null };
}

/** Impact = (group expectancy − rest expectancy) × group size: what the group cost versus trading like the rest. */
function compare(key: string, title: string, description: string, group: Group, minSample: number, suggestedRule: SuggestedRule | null): Finding | null {
  if (group.trades.length < minSample || group.rest.length < minSample) return null;
  const g = stats(group.trades);
  const r = stats(group.rest);
  if (!g.expectancy || !r.expectancy) return null;
  const impactPnl = g.expectancy.minus(r.expectancy).times(g.count);
  if (impactPnl.greaterThanOrEqualTo(0)) return null;
  const impactR = g.expectancyR && r.expectancyR ? g.expectancyR.minus(r.expectancyR).times(g.rCount) : null;
  return { key, title, description, sampleSize: g.count, impactPnl, impactR, groupExpectancy: g.expectancy, restExpectancy: r.expectancy, suggestedRule, kind: "leak" };
}

function split(all: LeakTrade[], predicate: (t: LeakTrade) => boolean): Group {
  const trades: LeakTrade[] = [];
  const rest: LeakTrade[] = [];
  for (const t of all) (predicate(t) ? trades : rest).push(t);
  return { trades, rest };
}

function dayGroups(trades: LeakTrade[], timeZone: string): Map<string, LeakTrade[]> {
  const days = new Map<string, LeakTrade[]>();
  for (const t of trades) {
    const key = dateKeyInZone(t.entryAt, timeZone);
    days.set(key, [...(days.get(key) ?? []), t]);
  }
  for (const list of days.values()) list.sort((a, b) => a.entryAt.getTime() - b.entryAt.getTime() || a.id.localeCompare(b.id));
  return days;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function findLeaks(input: LeakTrade[], ctx: LeakContext, options: LeakOptions = {}): Finding[] {
  const revengeMinutes = options.revengeMinutes ?? 30;
  const minSample = options.minSample ?? 5;
  const all = closedOnly(input) as LeakTrade[];
  const findings: Finding[] = [];
  const days = dayGroups(all, ctx.timeZone);

  // 1. Revenge trading: opened within N minutes of a loss closing.
  const revenge = new Set<string>();
  const afterTwoLosses = new Set<string>();
  for (const list of days.values()) {
    for (const t of list) {
      const priorLosses = list.filter((o) => o.id !== t.id && o.exitAt && o.exitAt.getTime() <= t.entryAt.getTime() && toDecimal(o.pnl as DecimalInput).lessThan(0));
      if (priorLosses.some((o) => t.entryAt.getTime() - (o.exitAt as Date).getTime() <= revengeMinutes * 60000)) revenge.add(t.id);
      // consecutive losses immediately before this trade (by exit order)
      const closedBefore = list.filter((o) => o.id !== t.id && o.exitAt && o.exitAt.getTime() <= t.entryAt.getTime()).sort((a, b) => (a.exitAt as Date).getTime() - (b.exitAt as Date).getTime());
      const lastTwo = closedBefore.slice(-2);
      if (lastTwo.length === 2 && lastTwo.every((o) => toDecimal(o.pnl as DecimalInput).lessThan(0))) afterTwoLosses.add(t.id);
    }
  }
  const revengeFinding = compare(
    "revenge",
    "Revenge trading",
    `Trades opened within ${revengeMinutes} minutes of a losing trade closing do worse than the rest.`,
    split(all, (t) => revenge.has(t.id)),
    minSample,
    { kind: "CUSTOM", title: `Wait ${revengeMinutes} minutes after a loss` },
  );
  if (revengeFinding) findings.push(revengeFinding);

  // 2. After two consecutive losses.
  const twoLosses = compare(
    "after-two-losses",
    "Trading on after two losses",
    "The trade taken right after two consecutive losses underperforms the rest.",
    split(all, (t) => afterTwoLosses.has(t.id)),
    minSample,
    { kind: "CUSTOM", title: "Stop for the day after two consecutive losses" },
  );
  if (twoLosses) findings.push(twoLosses);

  // 3. Worst hour of day.
  const hours = byHourOfDay(all, ctx.timeZone).filter((b) => b.tradeCount >= minSample);
  const worstHour = worstBucket(hours);
  if (worstHour) {
    const hour = Number(worstHour.key);
    const allHours = byHourOfDay(all, ctx.timeZone).map((b) => Number(b.key));
    const earliest = Math.min(...allHours);
    const latest = Math.max(...allHours);
    const suggestion: SuggestedRule =
      hour === earliest
        ? { kind: "NO_TRADES_BEFORE", title: `No trades before ${pad(hour + 1)}:00`, timeValue: `${pad(hour + 1)}:00` }
        : hour === latest
          ? { kind: "NO_TRADES_AFTER", title: `No trades after ${pad(hour)}:00`, timeValue: `${pad(hour)}:00` }
          : { kind: "CUSTOM", title: `No trades between ${pad(hour)}:00 and ${pad(hour + 1)}:00` };
    const f = compare(
      "worst-hour",
      `Worst hour: ${worstHour.label}`,
      `Trades entered between ${worstHour.label} and ${pad(hour + 1)}:00 do worse than trades at other times.`,
      split(all, (t) => toWallTime(t.entryAt, ctx.timeZone).hour === hour),
      minSample,
      suggestion,
    );
    if (f) findings.push(f);
  }

  // 4. Worst day of week (and 9. the Friday effect when Friday is not already the worst day).
  const weekdays = byDayOfWeek(all, ctx.timeZone).filter((b) => b.tradeCount >= minSample);
  const worstDay = worstBucket(weekdays);
  if (worstDay) {
    const f = compare(
      "worst-weekday",
      `Worst day: ${worstDay.label}`,
      `${worstDay.label} trades do worse than the rest of the week.`,
      split(all, (t) => weekdayLabel(t.entryAt, ctx.timeZone) === worstDay.key),
      minSample,
      { kind: "CUSTOM", title: `No trading on ${worstDay.label}s` },
    );
    if (f) findings.push(f);
  }
  if (!worstDay || worstDay.key !== "Friday") {
    const friday = compare(
      "friday",
      "Friday effect",
      "Friday trades do worse than the rest of the week.",
      split(all, (t) => weekdayLabel(t.entryAt, ctx.timeZone) === "Friday"),
      minSample,
      { kind: "CUSTOM", title: "No trading on Fridays" },
    );
    if (friday) findings.push(friday);
  }

  // 5. Oversized trades: top 20% by planned risk.
  const risks = all.map((t) => toDecimalOrNull(t.plannedRisk)?.toNumber() ?? null).filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (risks.length >= minSample * 2) {
    const cutoff = risks[Math.floor(risks.length * 0.8)];
    const f = compare(
      "oversized",
      "Oversized trades",
      "The largest fifth of trades by planned risk does worse than the rest.",
      split(all, (t) => (toDecimalOrNull(t.plannedRisk)?.toNumber() ?? -1) >= cutoff),
      minSample,
      { kind: "CUSTOM", title: `Keep planned risk under ${cutoff.toFixed(0)} per trade` },
    );
    if (f) findings.push(f);
  }

  // 6. Overtrading days: above the plan when a plan exists, otherwise above the 80th percentile of daily counts.
  const planByDate = new Map(ctx.plans.filter((p) => p.maxTrades !== null).map((p) => [p.date, p.maxTrades as number]));
  const counts = [...days.values()].map((l) => l.length).sort((a, b) => a - b);
  const heavyCutoff = counts.length ? counts[Math.min(counts.length - 1, Math.floor(counts.length * 0.8))] : Infinity;
  const overtradingDays = new Set<string>();
  for (const [date, list] of days) {
    const plan = planByDate.get(date);
    if (plan !== undefined ? list.length > plan : counts.length >= 5 && list.length > heavyCutoff) overtradingDays.add(date);
  }
  const medianCount = counts.length ? counts[Math.floor((counts.length - 1) / 2)] : 0;
  const over = compare(
    "overtrading",
    "Overtrading days",
    planByDate.size ? "Days that went past the planned trade count do worse than days that stayed within it." : "The busiest days do worse than normal days.",
    split(all, (t) => overtradingDays.has(dateKeyInZone(t.entryAt, ctx.timeZone))),
    minSample,
    { kind: "MAX_TRADES_PER_DAY", title: `No more than ${Math.max(1, medianCount)} trades a day`, value: String(Math.max(1, medianCount)) },
  );
  if (over) findings.push(over);

  // 7. Holding losers longer than winners.
  const winners = all.filter((t) => toDecimal(t.pnl as DecimalInput).greaterThan(0));
  const losers = all.filter((t) => toDecimal(t.pnl as DecimalInput).lessThan(0));
  const medianHold = (list: LeakTrade[]) => {
    const m = list.map(holdMinutes).filter((v): v is number => v !== null).sort((a, b) => a - b);
    return m.length ? m[Math.floor((m.length - 1) / 2)] : null;
  };
  const winnerHold = medianHold(winners);
  const loserHold = medianHold(losers);
  if (winnerHold !== null && loserHold !== null && losers.length >= minSample && loserHold > winnerHold * 1.5) {
    const longLosers = losers.filter((t) => (holdMinutes(t) ?? 0) > winnerHold);
    let excess = ZERO;
    let excessR = ZERO;
    let rCount = 0;
    for (const t of longLosers) {
      const risk = toDecimalOrNull(t.plannedRisk);
      const pnl = toDecimal(t.pnl as DecimalInput);
      if (risk && pnl.plus(risk).lessThan(0)) {
        excess = excess.plus(pnl.plus(risk));
        excessR = excessR.plus((toDecimalOrNull(t.rMultiple) ?? ZERO).plus(1));
        rCount++;
      }
    }
    findings.push({
      key: "holding-losers",
      title: "Holding losers longer than winners",
      description: `Losers are held ${Math.round(loserHold)} minutes at the median against ${Math.round(winnerHold)} for winners. The impact is the loss beyond the planned stop on losers held longer than a typical winner.`,
      sampleSize: longLosers.length,
      impactPnl: excess,
      impactR: rCount ? excessR : null,
      groupExpectancy: stats(longLosers).expectancy ?? ZERO,
      restExpectancy: stats(winners).expectancy,
      suggestedRule: { kind: "MAX_RISK_PER_TRADE_R", title: "Never lose more than 1R on a trade", value: "1" },
      kind: "leak",
    });
  }

  // 8. Best-setup neglect: the best setup by expectancy traded in under 20% of trades.
  if (all.length >= minSample * 2) {
    let best: { setup: { id: string; name: string }; s: ReturnType<typeof stats> } | null = null;
    for (const setup of ctx.setups) {
      const mine = all.filter((t) => t.setupIds.includes(setup.id));
      if (mine.length < minSample) continue;
      const s = stats(mine);
      if (s.expectancy && (!best || s.expectancy.greaterThan(best.s.expectancy as Decimal))) best = { setup, s };
    }
    const overall = stats(all);
    if (best && overall.expectancy && best.s.expectancy && best.s.expectancy.greaterThan(overall.expectancy) && best.s.count / all.length < 0.2) {
      const missing = Math.round(all.length * 0.2) - best.s.count;
      const impact = best.s.expectancy.minus(overall.expectancy).times(missing);
      findings.push({
        key: "best-setup-neglect",
        title: `Best setup neglected: ${best.setup.name}`,
        description: `${best.setup.name} has the best expectancy but only ${best.s.count} of ${all.length} trades (${Math.round((best.s.count / all.length) * 100)}%). Trading it in a fifth of trades would have added roughly this much.`,
        sampleSize: best.s.count,
        impactPnl: impact,
        impactR: best.s.expectancyR && overall.expectancyR ? best.s.expectancyR.minus(overall.expectancyR).times(missing) : null,
        groupExpectancy: best.s.expectancy,
        restExpectancy: overall.expectancy,
        suggestedRule: { kind: "CUSTOM", title: `Look for ${best.setup.name} first` },
        kind: "opportunity",
      });
    }
  }

  // 9b. Last-hour effect: trades entered in the final hour of the owner's usual day (90th percentile entry hour).
  const entryHours = all.map((t) => toWallTime(t.entryAt, ctx.timeZone).hour).sort((a, b) => a - b);
  if (entryHours.length >= minSample * 2) {
    const lastHour = entryHours[Math.floor(entryHours.length * 0.9)];
    if (!worstHour || Number(worstHour.key) !== lastHour) {
      const f = compare(
        "last-hour",
        `Last-hour effect (${pad(lastHour)}:00 onwards)`,
        "Trades entered in the final hour of your usual day do worse than earlier trades.",
        split(all, (t) => toWallTime(t.entryAt, ctx.timeZone).hour >= lastHour),
        minSample,
        { kind: "NO_TRADES_AFTER", title: `No trades after ${pad(lastHour)}:00`, timeValue: `${pad(lastHour)}:00` },
      );
      if (f) findings.push(f);
    }
  }

  findings.sort((a, b) => a.impactPnl.comparedTo(b.impactPnl));
  return findings;
}

function worstBucket(buckets: Bucket[]): Bucket | null {
  let worst: Bucket | null = null;
  for (const b of buckets) {
    if (!b.expectancy) continue;
    if (!worst || b.expectancy.lessThan(worst.expectancy as Decimal)) worst = b;
  }
  return worst && (worst.expectancy as Decimal).lessThan(0) ? worst : null;
}

function weekdayLabel(date: Date, timeZone: string): string {
  const w = toWallTime(date, timeZone);
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay()];
}
