import "server-only";
import { adherenceSplit, overallAdherence, ruleCosts, weeklyAdherence, type AdherenceTrade, type GroupStats } from "@/lib/adherence";
import { db } from "@/lib/db";
import { toNumber, toPlainString } from "@/lib/decimal";
import { dateKeyInZone } from "@/lib/tz";

export interface GroupStatsDTO {
  tradeCount: number;
  closedCount: number;
  netPnl: number;
  expectancy: number | null;
  winRate: number | null;
  rCount: number;
  netR: number;
  expectancyR: number | null;
}

export interface WeeklyAdherenceDTO {
  week: string;
  followed: number;
  total: number;
  adherence: number | null;
  tradeCount: number;
  cleanTrades: number;
}

export interface RuleCostDTO {
  ruleId: string;
  title: string;
  kind: string;
  brokenCount: number;
  netPnl: number;
  avgPnl: number | null;
  netR: number;
  rCount: number;
}

export interface LedgerEntryDTO {
  id: string;
  tradeId: string;
  symbol: string;
  date: string;
  ruleTitle: string;
  status: "BROKEN" | "OVERRIDDEN";
  justification: string | null;
  pnl: number | null;
  rMultiple: number | null;
}

export interface AdherenceReport {
  overall: { followed: number; total: number; adherence: number | null };
  weekly: WeeklyAdherenceDTO[];
  clean: GroupStatsDTO;
  broken: GroupStatsDTO;
  ruleCosts: RuleCostDTO[];
  ledger: LedgerEntryDTO[];
  ruleCount: number;
}

function groupDto(g: GroupStats): GroupStatsDTO {
  return {
    tradeCount: g.tradeCount,
    closedCount: g.closedCount,
    netPnl: g.netPnl.toNumber(),
    expectancy: toNumber(g.expectancy),
    winRate: toNumber(g.winRate),
    rCount: g.rCount,
    netR: g.netR.toNumber(),
    expectancyR: toNumber(g.expectancyR),
  };
}

export async function loadAdherenceReport(userId: string, timeZone: string, weeks = 12): Promise<AdherenceReport> {
  const [trades, rules] = await Promise.all([
    db.trade.findMany({
      where: { userId },
      select: {
        id: true,
        symbol: true,
        entryAt: true,
        exitAt: true,
        status: true,
        pnl: true,
        rMultiple: true,
        ruleEvents: { select: { id: true, ruleId: true, status: true, justification: true, rule: { select: { title: true } } } },
      },
      orderBy: { entryAt: "asc" },
    }),
    db.rule.findMany({ where: { userId }, select: { id: true, title: true, kind: true } }),
  ]);
  const adherenceTrades: AdherenceTrade[] = trades.map((t) => ({
    id: t.id,
    entryAt: t.entryAt,
    exitAt: t.exitAt,
    status: t.status,
    pnl: toPlainString(t.pnl),
    rMultiple: toPlainString(t.rMultiple),
    events: t.ruleEvents.map((e) => ({ ruleId: e.ruleId, status: e.status, justification: e.justification })),
  }));
  const overall = overallAdherence(adherenceTrades);
  const split = adherenceSplit(adherenceTrades);
  const titles = new Map(rules.map((r) => [r.id, r]));
  const ledger: LedgerEntryDTO[] = [];
  for (const t of [...trades].reverse()) {
    for (const e of t.ruleEvents) {
      if (e.status === "FOLLOWED") continue;
      ledger.push({
        id: e.id,
        tradeId: t.id,
        symbol: t.symbol,
        date: dateKeyInZone(t.entryAt, timeZone),
        ruleTitle: e.rule.title,
        status: e.status,
        justification: e.justification,
        pnl: toNumber(t.pnl),
        rMultiple: toNumber(t.rMultiple),
      });
      if (ledger.length >= 100) break;
    }
    if (ledger.length >= 100) break;
  }
  return {
    overall: { followed: overall.followed, total: overall.total, adherence: toNumber(overall.adherence) },
    weekly: weeklyAdherence(adherenceTrades, timeZone)
      .slice(-weeks)
      .map((w) => ({ ...w, adherence: toNumber(w.adherence) })),
    clean: groupDto(split.clean),
    broken: groupDto(split.broken),
    ruleCosts: ruleCosts(adherenceTrades).map((c) => ({
      ruleId: c.ruleId,
      title: titles.get(c.ruleId)?.title ?? "Deleted rule",
      kind: titles.get(c.ruleId)?.kind ?? "CUSTOM",
      brokenCount: c.brokenCount,
      netPnl: c.netPnl.toNumber(),
      avgPnl: toNumber(c.avgPnl),
      netR: c.netR.toNumber(),
      rCount: c.rCount,
    })),
    ledger,
    ruleCount: rules.length,
  };
}
