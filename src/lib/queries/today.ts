import "server-only";
import { db } from "@/lib/db";
import { toDecimalOrNull, toNumber, ZERO } from "@/lib/decimal";
import { serializeDay, serializeRule, serializeTag, serializeTrade, type DayDTO, type RuleDTO, type TagDTO, type TradeDTO } from "@/lib/serialize";
import { addDaysToKey, dateKeyInZone, endOfDayInZone, startOfDayInZone } from "@/lib/tz";

export interface BudgetDTO {
  tradesUsed: number;
  tradesAllowed: number | null;
  /** Realised loss so far as a positive number of R (0 when the day is up). */
  lossUsedR: number;
  lossAllowedR: number | null;
  lossUsedUsd: number;
  lossAllowedUsd: number | null;
  netR: number;
  netPnl: number;
  /** Where the limits come from: the day's plan, a rule, or nothing. */
  tradesSource: "plan" | "rule" | null;
  lossSource: "plan" | "rule" | null;
}

export interface DayEventDTO {
  id: string;
  tradeId: string;
  symbol: string;
  ruleTitle: string;
  status: "FOLLOWED" | "BROKEN" | "OVERRIDDEN";
  justification: string | null;
}

export interface TodayData {
  dateKey: string;
  isToday: boolean;
  prevKey: string;
  nextKey: string;
  day: DayDTO | null;
  trades: TradeDTO[];
  events: DayEventDTO[];
  followedCount: number;
  budget: BudgetDTO;
  rules: RuleDTO[];
  setups: TagDTO[];
  currency: string;
}

const relationInclude = {
  account: { select: { id: true, name: true, currency: true } },
  tags: { orderBy: { name: "asc" as const } },
  ruleEvents: { include: { rule: { select: { title: true, kind: true } } } },
};

/** Trades-used and loss-used figures for one day, against the plan or the matching rules. */
export async function loadBudget(userId: string, timeZone: string, dateKey: string): Promise<BudgetDTO> {
  const [day, trades, rules] = await Promise.all([
    db.day.findUnique({ where: { userId_date: { userId, date: dateKey } }, select: { maxTrades: true, maxLossR: true } }),
    db.trade.findMany({
      where: { userId, entryAt: { gte: startOfDayInZone(dateKey, timeZone), lt: endOfDayInZone(dateKey, timeZone) } },
      select: { pnl: true, rMultiple: true, status: true },
    }),
    db.rule.findMany({ where: { userId, active: true, kind: { in: ["MAX_TRADES_PER_DAY", "MAX_DAILY_LOSS_R", "MAX_DAILY_LOSS_USD"] } } }),
  ]);
  let netR = ZERO;
  let netPnl = ZERO;
  for (const t of trades) {
    if (t.status !== "CLOSED") continue;
    const r = toDecimalOrNull(t.rMultiple);
    if (r) netR = netR.plus(r);
    const p = toDecimalOrNull(t.pnl);
    if (p) netPnl = netPnl.plus(p);
  }
  const ruleValue = (kind: string) => toNumber(rules.find((r) => r.kind === kind)?.value ?? null);
  const tradesAllowed = day?.maxTrades ?? ruleValue("MAX_TRADES_PER_DAY");
  const planLossR = toNumber(day?.maxLossR ?? null);
  const lossAllowedR = planLossR ?? ruleValue("MAX_DAILY_LOSS_R");
  return {
    tradesUsed: trades.length,
    tradesAllowed,
    lossUsedR: netR.lessThan(0) ? netR.abs().toNumber() : 0,
    lossAllowedR,
    lossUsedUsd: netPnl.lessThan(0) ? netPnl.abs().toNumber() : 0,
    lossAllowedUsd: ruleValue("MAX_DAILY_LOSS_USD"),
    netR: netR.toNumber(),
    netPnl: netPnl.toNumber(),
    tradesSource: day?.maxTrades != null ? "plan" : tradesAllowed !== null ? "rule" : null,
    lossSource: planLossR !== null ? "plan" : lossAllowedR !== null ? "rule" : null,
  };
}

export async function loadToday(userId: string, timeZone: string, requestedKey?: string): Promise<TodayData> {
  const todayKey = dateKeyInZone(new Date(), timeZone);
  const dateKey = requestedKey && /^\d{4}-\d{2}-\d{2}$/.test(requestedKey) ? requestedKey : todayKey;
  const [day, trades, rules, setups, budget, defaultAccount] = await Promise.all([
    db.day.findUnique({ where: { userId_date: { userId, date: dateKey } } }),
    db.trade.findMany({
      where: { userId, entryAt: { gte: startOfDayInZone(dateKey, timeZone), lt: endOfDayInZone(dateKey, timeZone) } },
      orderBy: [{ entryAt: "asc" }, { createdAt: "asc" }],
      include: relationInclude,
    }),
    db.rule.findMany({ where: { userId }, orderBy: [{ active: "desc" }, { createdAt: "asc" }] }),
    db.tag.findMany({ where: { userId, kind: "SETUP" }, orderBy: { name: "asc" } }),
    loadBudget(userId, timeZone, dateKey),
    db.account.findFirst({ where: { userId }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], select: { currency: true } }),
  ]);
  const events: DayEventDTO[] = [];
  let followedCount = 0;
  for (const t of trades) {
    for (const e of t.ruleEvents) {
      if (e.status === "FOLLOWED") {
        followedCount++;
        continue;
      }
      events.push({ id: e.id, tradeId: t.id, symbol: t.symbol, ruleTitle: e.rule.title, status: e.status, justification: e.justification });
    }
  }
  return {
    dateKey,
    isToday: dateKey === todayKey,
    prevKey: addDaysToKey(dateKey, -1),
    nextKey: addDaysToKey(dateKey, 1),
    day: day ? serializeDay(day) : null,
    trades: trades.map(serializeTrade),
    events,
    followedCount,
    budget,
    rules: rules.map(serializeRule),
    setups: setups.map(serializeTag),
    currency: defaultAccount?.currency ?? "USD",
  };
}
