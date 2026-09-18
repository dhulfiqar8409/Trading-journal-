import "server-only";
import type { Rule, Trade } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { toPlainString } from "@/lib/decimal";
import { evaluateRules, type Evaluation, type RuleLike, type RuleTrade } from "@/lib/rules";
import { dateKeyInZone, endOfDayInZone, startOfDayInZone } from "@/lib/tz";

export function toRuleLike(rule: Rule): RuleLike {
  return { id: rule.id, title: rule.title, kind: rule.kind, value: toPlainString(rule.value), timeValue: rule.timeValue, active: rule.active };
}

export function toRuleTrade(t: Pick<Trade, "id" | "entryAt" | "exitAt" | "status" | "quantity" | "stopPrice" | "pnl" | "rMultiple">): RuleTrade {
  return {
    id: t.id,
    entryAt: t.entryAt,
    exitAt: t.exitAt,
    status: t.status,
    quantity: toPlainString(t.quantity) ?? "0",
    stopPrice: toPlainString(t.stopPrice),
    pnl: toPlainString(t.pnl),
    rMultiple: toPlainString(t.rMultiple),
  };
}

export async function loadActiveRules(userId: string): Promise<Rule[]> {
  return db.rule.findMany({ where: { userId, active: true }, orderBy: { createdAt: "asc" } });
}

/** Trades of the calendar day (owner's zone) that contains `at`, as rule inputs. */
export async function dayContextTrades(userId: string, timeZone: string, at: Date, excludeId?: string): Promise<RuleTrade[]> {
  const key = dateKeyInZone(at, timeZone);
  const trades = await db.trade.findMany({
    where: {
      userId,
      entryAt: { gte: startOfDayInZone(key, timeZone), lt: endOfDayInZone(key, timeZone) },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, entryAt: true, exitAt: true, status: true, quantity: true, stopPrice: true, pnl: true, rMultiple: true },
  });
  return trades.map(toRuleTrade);
}

/** Deterministic verdicts for a (possibly unsaved) trade against the owner's active rules. */
export async function evaluateCandidate(
  userId: string,
  timeZone: string,
  candidate: RuleTrade,
  rules: Rule[],
  excludeId?: string,
): Promise<Evaluation[]> {
  const others = await dayContextTrades(userId, timeZone, candidate.entryAt, excludeId);
  return evaluateRules(rules.map(toRuleLike), candidate, { timeZone, dayTrades: [...others, candidate] });
}
