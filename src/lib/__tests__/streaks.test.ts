import { describe, expect, it } from "vitest";
import { badges, processStreak, type SessionInput } from "@/lib/streaks";

function s(date: string, extra: Partial<SessionInput> = {}): SessionInput {
  return { date, tradeCount: 2, allTagged: true, checkedIn: true, reviewed: true, ruleBroken: false, planned: true, withinPlan: true, pnl: "10", ...extra };
}

describe("process streaks", () => {
  it("counts consecutive fully journaled, rule-compliant sessions regardless of P&L", () => {
    const sessions = [
      s("2026-09-10", { pnl: "-50" }),
      s("2026-09-11", { pnl: "-20" }),
      s("2026-09-12", { reviewed: false }),
      s("2026-09-15", { pnl: "-5" }),
      s("2026-09-16", { pnl: "40" }),
      s("2026-09-17"),
    ];
    const streak = processStreak(sessions);
    expect(streak.current).toBe(3);
    expect(streak.best).toBe(3);
    expect(streak.latestMissing).toEqual([]);
    expect(streak.sessions).toBe(6);
  });

  it("breaks the run on a broken rule or a missing tag and explains what is missing", () => {
    const sessions = [s("2026-09-15"), s("2026-09-16"), s("2026-09-17", { ruleBroken: true, allTagged: false })];
    const streak = processStreak(sessions);
    expect(streak.current).toBe(0);
    expect(streak.best).toBe(2);
    expect(streak.latestMissing).toEqual(["tags on every trade", "a rule was broken"]);
    expect(processStreak([])).toEqual({ current: 0, best: 0, latestMissing: [], sessions: 0 });
  });

  it("ignores date order in the input", () => {
    const sessions = [s("2026-09-17"), s("2026-09-15"), s("2026-09-16")];
    expect(processStreak(sessions).current).toBe(3);
  });

  it("awards quiet process badges at thresholds, never for green days", () => {
    const sessions: SessionInput[] = [];
    for (let i = 1; i <= 12; i++) sessions.push(s(`2026-08-${String(i).padStart(2, "0")}`, { pnl: i % 2 ? "-10" : "10" }));
    const earned = badges(sessions);
    expect(earned.map((b) => [b.key, b.threshold, b.count])).toEqual([
      ["red-reviewed", 5, 6],
      ["on-plan", 10, 12],
      ["journaled", 10, 12],
    ]);
    expect(badges([])).toEqual([]);
    expect(badges(sessions.map((x) => ({ ...x, pnl: "100" }))).find((b) => b.key === "red-reviewed")).toBeUndefined();
  });
});
