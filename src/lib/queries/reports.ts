import "server-only";
import { adherenceSplit, overallAdherence, ruleCosts, weeklyAdherence, type AdherenceTrade, type GroupStats } from "@/lib/adherence";
import {
  byAccount,
  byDayOfWeek,
  byDaysToExpiration,
  byHoldDuration,
  byHourOfDay,
  byInstrument,
  byOptionType,
  bySide,
  bySizeBucket,
  optionsVsShares,
  rDistribution,
  type Bucket,
  type BreakdownTrade,
} from "@/lib/breakdowns";
import { bucketByState, plannedVsUnplanned, type DayState } from "@/lib/day-stats";
import { db } from "@/lib/db";
import { toNumber, toPlainString } from "@/lib/decimal";
import { edgeDecay } from "@/lib/edge-decay";
import { findLeaks, type LeakTrade } from "@/lib/leaks";
import { tradeLabel } from "@/lib/options";
import { dateKeyInZone } from "@/lib/tz";

export interface BucketDTO {
  key: string;
  label: string;
  tradeCount: number;
  wins: number;
  netPnl: number;
  expectancy: number | null;
  winRate: number | null;
  netR: number;
  rCount: number;
  expectancyR: number | null;
}

export interface FindingDTO {
  key: string;
  title: string;
  description: string;
  sampleSize: number;
  impactPnl: number;
  impactR: number | null;
  groupExpectancy: number;
  restExpectancy: number | null;
  kind: "leak" | "opportunity";
  /** Query string for /rules that pre-fills the suggested rule. */
  addRuleHref: string | null;
}

export interface BreakdownsReport {
  hour: BucketDTO[];
  weekday: BucketDTO[];
  hold: BucketDTO[];
  size: { buckets: BucketDTO[]; basis: "risk" | "notional"; thresholds: [number, number] };
  rBins: { key: string; label: string; count: number }[];
  rTotal: number;
  instrument: BucketDTO[];
  side: BucketDTO[];
  account: BucketDTO[];
  mood: BucketDTO[];
  focus: BucketDTO[];
  energy: BucketDTO[];
  sleep: BucketDTO[];
  planned: BucketDTO[];
  /** Options: calls against puts, options against shares, and days to expiration when entered. */
  optionType: BucketDTO[];
  optionsVsShares: BucketDTO[];
  dte: BucketDTO[];
  optionCount: number;
  closedCount: number;
  daysWithState: number;
}

function bucketDto(b: Bucket): BucketDTO {
  return {
    key: b.key,
    label: b.label,
    tradeCount: b.tradeCount,
    wins: b.wins,
    netPnl: b.netPnl.toNumber(),
    expectancy: toNumber(b.expectancy),
    winRate: toNumber(b.winRate),
    netR: b.netR.toNumber(),
    rCount: b.rCount,
    expectancyR: toNumber(b.expectancyR),
  };
}

async function loadBreakdownTrades(userId: string): Promise<LeakTrade[]> {
  const trades = await db.trade.findMany({
    where: { userId, status: "CLOSED" },
    select: {
      id: true,
      symbol: true,
      assetClass: true,
      side: true,
      status: true,
      pnl: true,
      rMultiple: true,
      plannedRisk: true,
      quantity: true,
      entryPrice: true,
      multiplier: true,
      entryAt: true,
      exitAt: true,
      optionType: true,
      expiresAt: true,
      account: { select: { name: true } },
      tags: { select: { id: true, kind: true } },
    },
  });
  return trades.map((t) => ({
    id: t.id,
    symbol: t.symbol,
    assetClass: t.assetClass,
    side: t.side,
    accountName: t.account.name,
    status: t.status,
    pnl: toPlainString(t.pnl),
    rMultiple: toPlainString(t.rMultiple),
    plannedRisk: toPlainString(t.plannedRisk),
    quantity: toPlainString(t.quantity) ?? "0",
    entryPrice: toPlainString(t.entryPrice) ?? "0",
    multiplier: toPlainString(t.multiplier) ?? "1",
    entryAt: t.entryAt,
    exitAt: t.exitAt,
    optionType: t.optionType,
    expiresAt: t.expiresAt,
    setupIds: t.tags.filter((tag) => tag.kind === "SETUP").map((tag) => tag.id),
  }));
}

export async function loadBreakdowns(userId: string, timeZone: string): Promise<BreakdownsReport> {
  const [trades, days] = await Promise.all([
    loadBreakdownTrades(userId),
    db.day.findMany({ where: { userId }, select: { date: true, mood: true, sleepHours: true, focus: true, energy: true, checkedInAt: true, maxTrades: true, maxLossR: true } }),
  ]);
  const states: DayState[] = days.map((d) => ({
    date: d.date,
    mood: d.mood,
    sleepHours: toNumber(d.sleepHours),
    focus: d.focus,
    energy: d.energy,
    checkedIn: !!d.checkedInAt,
    hasPlan: d.maxTrades !== null || d.maxLossR !== null,
  }));
  const size = bySizeBucket(trades);
  const dist = rDistribution(trades);
  const base = trades as BreakdownTrade[];
  return {
    hour: byHourOfDay(base, timeZone).map(bucketDto),
    weekday: byDayOfWeek(base, timeZone).map(bucketDto),
    hold: byHoldDuration(base).map(bucketDto),
    size: { buckets: size.buckets.map(bucketDto), basis: size.basis, thresholds: size.thresholds },
    rBins: dist.bins.map((b) => ({ key: b.key, label: b.label, count: b.count })),
    rTotal: dist.total,
    instrument: byInstrument(base).map(bucketDto),
    side: bySide(base).map(bucketDto),
    account: byAccount(base).map(bucketDto),
    mood: bucketByState(base, states, timeZone, "mood").map(bucketDto),
    focus: bucketByState(base, states, timeZone, "focus").map(bucketDto),
    energy: bucketByState(base, states, timeZone, "energy").map(bucketDto),
    sleep: bucketByState(base, states, timeZone, "sleep").map(bucketDto),
    planned: plannedVsUnplanned(base, states, timeZone).map(bucketDto),
    optionType: byOptionType(base).map(bucketDto),
    optionsVsShares: optionsVsShares(base).map(bucketDto),
    dte: byDaysToExpiration(base, timeZone).map(bucketDto),
    optionCount: trades.filter((t) => t.assetClass === "OPTION").length,
    closedCount: trades.length,
    daysWithState: states.filter((d) => d.mood !== null || d.sleepHours !== null || d.focus !== null || d.energy !== null).length,
  };
}

export async function loadLeaks(userId: string, timeZone: string): Promise<FindingDTO[]> {
  const [trades, plans, setups] = await Promise.all([
    loadBreakdownTrades(userId),
    db.day.findMany({ where: { userId }, select: { date: true, maxTrades: true } }),
    db.tag.findMany({ where: { userId, kind: "SETUP" }, select: { id: true, name: true } }),
  ]);
  return findLeaks(trades, { timeZone, plans, setups }).map((f) => {
    let addRuleHref: string | null = null;
    if (f.suggestedRule) {
      const params = new URLSearchParams({ kind: f.suggestedRule.kind, title: f.suggestedRule.title });
      if (f.suggestedRule.value) params.set("value", f.suggestedRule.value);
      if (f.suggestedRule.timeValue) params.set("timeValue", f.suggestedRule.timeValue);
      addRuleHref = `/rules?${params.toString()}`;
    }
    // Only show the R impact when it agrees in sign with the money impact; mixed stops can make them disagree.
    const impactR = f.impactR && f.impactR.isNegative() === f.impactPnl.isNegative() ? f.impactR.toNumber() : null;
    return {
      key: f.key,
      title: f.title,
      description: f.description,
      sampleSize: f.sampleSize,
      impactPnl: f.impactPnl.toNumber(),
      impactR,
      groupExpectancy: f.groupExpectancy.toNumber(),
      restExpectancy: toNumber(f.restExpectancy),
      kind: f.kind,
      addRuleHref,
    };
  });
}

export interface DecayPointDTO {
  index: number;
  t: number;
  tradeId: string;
  mean: number;
  lower: number;
  upper: number;
  n: number;
}

export interface SetupDecayDTO {
  setupId: string;
  name: string;
  color: string;
  tradeCount: number;
  points: DecayPointDTO[];
  latest: DecayPointDTO | null;
  crossedBelowZero: boolean;
  suggestion: string | null;
}

export async function loadEdgeDecay(userId: string): Promise<SetupDecayDTO[]> {
  const [setups, trades] = await Promise.all([
    db.tag.findMany({ where: { userId, kind: "SETUP" }, orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
    db.trade.findMany({
      where: { userId, status: "CLOSED", rMultiple: { not: null }, tags: { some: { kind: "SETUP" } } },
      select: { id: true, exitAt: true, status: true, rMultiple: true, tags: { select: { id: true, kind: true } } },
    }),
  ]);
  const colors = new Map(setups.map((s) => [s.id, s.color]));
  return edgeDecay(
    trades.map((t) => ({
      id: t.id,
      exitAt: t.exitAt,
      status: t.status,
      rMultiple: toPlainString(t.rMultiple),
      setupIds: t.tags.filter((tag) => tag.kind === "SETUP").map((tag) => tag.id),
    })),
    setups,
  ).map((d) => ({ ...d, color: colors.get(d.setupId) ?? "#6b7280" }));
}

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
        assetClass: true,
        optionType: true,
        strikePrice: true,
        expiresAt: true,
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
        symbol: tradeLabel(t),
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
