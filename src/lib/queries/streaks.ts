import "server-only";
import { db } from "@/lib/db";
import { toDecimalOrNull, toNumber, ZERO } from "@/lib/decimal";
import { badges, processStreak, type Badge, type SessionInput, type StreakSummary } from "@/lib/streaks";
import { dateKeyInZone } from "@/lib/tz";

export interface StreakDTO {
  streak: StreakSummary;
  badges: Badge[];
}

/** One session per calendar day with trades, joined with that day's check-in, review and rule events. */
export async function loadSessions(userId: string, timeZone: string): Promise<SessionInput[]> {
  const [trades, days] = await Promise.all([
    db.trade.findMany({
      where: { userId },
      select: {
        entryAt: true,
        status: true,
        pnl: true,
        rMultiple: true,
        tags: { select: { id: true } },
        ruleEvents: { select: { status: true } },
      },
    }),
    db.day.findMany({ where: { userId }, select: { date: true, maxTrades: true, maxLossR: true, checkedInAt: true, reviewedAt: true } }),
  ]);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const sessions = new Map<string, { count: number; allTagged: boolean; ruleBroken: boolean; pnl: ReturnType<typeof ZERO.plus>; r: ReturnType<typeof ZERO.plus> }>();
  for (const t of trades) {
    const key = dateKeyInZone(t.entryAt, timeZone);
    const s = sessions.get(key) ?? { count: 0, allTagged: true, ruleBroken: false, pnl: ZERO, r: ZERO };
    s.count++;
    if (t.tags.length === 0) s.allTagged = false;
    if (t.ruleEvents.some((e) => e.status !== "FOLLOWED")) s.ruleBroken = true;
    if (t.status === "CLOSED") {
      const p = toDecimalOrNull(t.pnl);
      if (p) s.pnl = s.pnl.plus(p);
      const r = toDecimalOrNull(t.rMultiple);
      if (r) s.r = s.r.plus(r);
    }
    sessions.set(key, s);
  }
  return [...sessions.entries()].map(([date, s]) => {
    const day = byDate.get(date);
    const planned = !!day && (day.maxTrades !== null || day.maxLossR !== null);
    const maxLoss = toNumber(day?.maxLossR ?? null);
    const withinPlan =
      planned &&
      (day?.maxTrades === null || day?.maxTrades === undefined || s.count <= day.maxTrades) &&
      (maxLoss === null || s.r.greaterThanOrEqualTo(-maxLoss));
    return {
      date,
      tradeCount: s.count,
      allTagged: s.allTagged,
      checkedIn: !!day?.checkedInAt,
      reviewed: !!day?.reviewedAt,
      ruleBroken: s.ruleBroken,
      planned,
      withinPlan,
      pnl: s.pnl.toFixed(),
    };
  });
}

export async function loadStreaks(userId: string, timeZone: string): Promise<StreakDTO> {
  const sessions = await loadSessions(userId, timeZone);
  return { streak: processStreak(sessions), badges: badges(sessions) };
}
