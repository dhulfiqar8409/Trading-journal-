import "server-only";
import { overallAdherence } from "@/lib/adherence";
import { db } from "@/lib/db";
import { toDecimalOrNull, toNumber, toPlainString, ZERO } from "@/lib/decimal";
import { edgeScore } from "@/lib/edge-score";
import { mistakeCosts } from "@/lib/mistakes";
import { loadLeaks, type FindingDTO } from "@/lib/queries/reports";
import { dateKeyInZone } from "@/lib/tz";
import { isoWeekLabel, isoWeekRange, parseIsoWeekKey, shiftIsoWeek } from "@/lib/weeks";

export interface WeekReview {
  week: string;
  label: string;
  prevWeek: string;
  nextWeek: string;
  fromKey: string;
  toKey: string;
  currency: string;
  timeZone: string;
  entered: number;
  closed: number;
  wins: number;
  netR: number;
  rCount: number;
  netPnl: number;
  winRate: number | null;
  adherence: number | null;
  checksTotal: number;
  edgeScore: number | null;
  edgeSample: number;
  topSetup: { name: string; netR: number; count: number } | null;
  biggestLeak: FindingDTO | null;
  mistakesCost: number;
  mistakesCount: number;
  daysTraded: number;
  daysCheckedIn: number;
  daysReviewed: number;
  bestDay: { date: string; pnl: number; r: number } | null;
  worstDay: { date: string; pnl: number; r: number } | null;
  oneChange: string | null;
}

export async function loadWeekReview(userId: string, timeZone: string, weekKey: string): Promise<WeekReview | null> {
  if (!parseIsoWeekKey(weekKey)) return null;
  const range = isoWeekRange(weekKey, timeZone);
  if (!range) return null;

  const [entered, closed, history, days, account, leaks] = await Promise.all([
    db.trade.count({ where: { userId, entryAt: { gte: range.from, lt: range.to } } }),
    db.trade.findMany({
      where: { userId, status: "CLOSED", exitAt: { gte: range.from, lt: range.to } },
      select: {
        id: true,
        exitAt: true,
        pnl: true,
        rMultiple: true,
        tags: { select: { id: true, name: true, kind: true } },
        ruleEvents: { select: { ruleId: true, status: true } },
      },
    }),
    db.trade.findMany({
      where: { userId, status: "CLOSED", exitAt: { lt: range.to } },
      select: { id: true, exitAt: true, pnl: true },
      orderBy: { exitAt: "asc" },
    }),
    db.day.findMany({ where: { userId, date: { gte: range.fromKey, lte: range.toKey } }, select: { date: true, checkedInAt: true, reviewedAt: true, oneChange: true } }),
    db.account.findFirst({ where: { userId }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], select: { currency: true } }),
    loadLeaks(userId, timeZone),
  ]);

  let netR = ZERO;
  let netPnl = ZERO;
  let rCount = 0;
  let wins = 0;
  const daily = new Map<string, { pnl: number; r: number }>();
  const setups = new Map<string, { name: string; netR: number; count: number }>();
  for (const t of closed) {
    const pnl = toDecimalOrNull(t.pnl) ?? ZERO;
    const r = toDecimalOrNull(t.rMultiple);
    netPnl = netPnl.plus(pnl);
    if (pnl.greaterThan(0)) wins++;
    if (r) {
      netR = netR.plus(r);
      rCount++;
    }
    const key = dateKeyInZone(t.exitAt as Date, timeZone);
    const d = daily.get(key) ?? { pnl: 0, r: 0 };
    d.pnl += pnl.toNumber();
    d.r += r ? r.toNumber() : 0;
    daily.set(key, d);
    for (const tag of t.tags) {
      if (tag.kind !== "SETUP") continue;
      const s = setups.get(tag.id) ?? { name: tag.name, netR: 0, count: 0 };
      s.netR += r ? r.toNumber() : 0;
      s.count++;
      setups.set(tag.id, s);
    }
  }
  const adherence = overallAdherence(
    closed.map((t) => ({ id: t.id, entryAt: t.exitAt as Date, exitAt: t.exitAt, status: "CLOSED" as const, pnl: null, rMultiple: null, events: t.ruleEvents })),
  );
  const edge = edgeScore(
    history.filter((t) => t.exitAt && t.pnl !== null).map((t) => ({ id: t.id, exitAt: t.exitAt as Date, pnl: toPlainString(t.pnl) as string })),
    { timeZone },
  );
  const mistakes = mistakeCosts(closed.map((t) => ({ id: t.id, status: "CLOSED" as const, pnl: toPlainString(t.pnl), rMultiple: toPlainString(t.rMultiple), tags: t.tags })));
  const dayEntries = [...daily.entries()].map(([date, v]) => ({ date, ...v }));
  const best = dayEntries.length ? dayEntries.reduce((a, b) => (b.pnl > a.pnl ? b : a)) : null;
  const worst = dayEntries.length ? dayEntries.reduce((a, b) => (b.pnl < a.pnl ? b : a)) : null;
  const topSetup = [...setups.values()].sort((a, b) => b.netR - a.netR || b.count - a.count)[0] ?? null;
  const lastReview = days.filter((d) => d.oneChange).sort((a, b) => b.date.localeCompare(a.date))[0];

  return {
    week: weekKey,
    label: isoWeekLabel(weekKey),
    prevWeek: shiftIsoWeek(weekKey, -1) ?? weekKey,
    nextWeek: shiftIsoWeek(weekKey, 1) ?? weekKey,
    fromKey: range.fromKey,
    toKey: range.toKey,
    currency: account?.currency ?? "USD",
    timeZone,
    entered,
    closed: closed.length,
    wins,
    netR: netR.toNumber(),
    rCount,
    netPnl: netPnl.toNumber(),
    winRate: closed.length ? wins / closed.length : null,
    adherence: toNumber(adherence.adherence),
    checksTotal: adherence.total,
    edgeScore: edge.score,
    edgeSample: edge.sampleSize,
    topSetup,
    biggestLeak: leaks.find((l) => l.kind === "leak") ?? null,
    mistakesCost: mistakes.reduce((acc, m) => acc + m.netPnl.toNumber(), 0),
    mistakesCount: mistakes.reduce((acc, m) => acc + m.count, 0),
    daysTraded: daily.size,
    daysCheckedIn: days.filter((d) => d.checkedInAt).length,
    daysReviewed: days.filter((d) => d.reviewedAt).length,
    bestDay: best,
    worstDay: worst,
    oneChange: lastReview?.oneChange ?? null,
  };
}
