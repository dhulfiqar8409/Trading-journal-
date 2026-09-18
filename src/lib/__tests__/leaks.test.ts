import { describe, expect, it } from "vitest";
import { findLeaks, type LeakContext, type LeakTrade } from "@/lib/leaks";

let n = 0;
function t(entryAt: string, holdMin: number, pnl: string | null, extra: Partial<LeakTrade> = {}): LeakTrade {
  n++;
  const entry = new Date(entryAt);
  const risk = extra.plannedRisk === undefined ? "100" : extra.plannedRisk;
  return {
    id: `t${String(n).padStart(3, "0")}`,
    symbol: "X",
    assetClass: "STOCK",
    side: "LONG",
    accountName: "Main",
    status: pnl === null ? "OPEN" : "CLOSED",
    pnl,
    rMultiple: pnl === null || risk === null ? null : String(Number(pnl) / Number(risk)),
    plannedRisk: risk,
    quantity: "10",
    entryPrice: "100",
    multiplier: "1",
    entryAt: entry,
    exitAt: pnl === null ? null : new Date(entry.getTime() + holdMin * 60000),
    setupIds: [],
    ...extra,
  };
}

const ctx: LeakContext = { timeZone: "UTC", plans: [], setups: [{ id: "a", name: "Breakout" }, { id: "b", name: "Pullback" }] };

describe("findLeaks", () => {
  it("returns nothing for empty or tiny samples", () => {
    expect(findLeaks([], ctx)).toEqual([]);
    expect(findLeaks([t("2026-09-14T10:00:00Z", 10, "-50")], ctx)).toEqual([]);
  });

  it("detects revenge trading and ranks by cost", () => {
    const trades: LeakTrade[] = [];
    // 6 days: a loss at 10:00 closing 10:10, then a revenge trade at 10:15 that loses; a calm trade at 13:00 that wins.
    for (let d = 14; d < 20; d++) {
      trades.push(t(`2026-09-${d}T10:00:00Z`, 10, "-50"));
      trades.push(t(`2026-09-${d}T10:15:00Z`, 10, "-80"));
      trades.push(t(`2026-09-${d}T13:00:00Z`, 10, "120"));
    }
    const findings = findLeaks(trades, ctx);
    const revenge = findings.find((f) => f.key === "revenge")!;
    expect(revenge).toBeDefined();
    expect(revenge.sampleSize).toBe(6);
    expect(revenge.impactPnl.lessThan(0)).toBe(true);
    expect(revenge.impactR!.lessThan(0)).toBe(true);
    expect(revenge.suggestedRule).toEqual({ kind: "CUSTOM", title: "Wait 30 minutes after a loss" });
    expect(findings[0].impactPnl.lessThanOrEqualTo(findings[findings.length - 1].impactPnl)).toBe(true);
    // The 10:00 hour is the worst hour and the first hour of the day -> no-trades-before suggestion.
    const hour = findings.find((f) => f.key === "worst-hour")!;
    expect(hour.suggestedRule).toEqual({ kind: "NO_TRADES_BEFORE", title: "No trades before 11:00", timeValue: "11:00" });
    // Fridays (2026-09-18) are not worse than other days here.
    expect(findings.find((f) => f.key === "friday")).toBeUndefined();
  });

  it("flags overtrading against the plan and suggests a daily cap", () => {
    const trades: LeakTrade[] = [];
    const plans = [];
    for (let d = 14; d < 20; d++) {
      plans.push({ date: `2026-09-${d}`, maxTrades: 2 });
      trades.push(t(`2026-09-${d}T10:00:00Z`, 10, "40"));
      trades.push(t(`2026-09-${d}T11:00:00Z`, 10, "30"));
      if (d % 2 === 0) {
        trades.push(t(`2026-09-${d}T12:00:00Z`, 10, "-70"));
        trades.push(t(`2026-09-${d}T14:00:00Z`, 10, "-60"));
      }
    }
    const over = findLeaks(trades, { ...ctx, plans }, { minSample: 3 }).find((f) => f.key === "overtrading")!;
    expect(over).toBeDefined();
    expect(over.sampleSize).toBe(12);
    expect(over.suggestedRule!.kind).toBe("MAX_TRADES_PER_DAY");
  });

  it("finds holding losers longer than winners and best-setup neglect", () => {
    const trades: LeakTrade[] = [];
    for (let i = 0; i < 8; i++) trades.push(t(`2026-09-${14 + (i % 5)}T10:0${i}:00Z`, 5, "50", { setupIds: ["b"] }));
    for (let i = 0; i < 6; i++) trades.push(t(`2026-09-${14 + (i % 5)}T12:0${i}:00Z`, 60, "-180", { setupIds: ["b"] }));
    // Breakout: best expectancy but rarely traded (2 of 16 = 12.5%).
    trades.push(t("2026-09-14T15:00:00Z", 5, "300", { setupIds: ["a"] }));
    trades.push(t("2026-09-15T15:00:00Z", 5, "260", { setupIds: ["a"] }));
    const findings = findLeaks(trades, ctx, { minSample: 2 });
    const holding = findings.find((f) => f.key === "holding-losers")!;
    expect(holding).toBeDefined();
    expect(holding.sampleSize).toBe(6);
    expect(holding.impactPnl.toFixed()).toBe("-480"); // 6 losers each 80 beyond the 100 stop
    expect(holding.impactR!.toFixed()).toBe("-4.8");
    expect(holding.suggestedRule!.kind).toBe("MAX_RISK_PER_TRADE_R");
    const neglect = findings.find((f) => f.key === "best-setup-neglect")!;
    expect(neglect).toBeDefined();
    expect(neglect.kind).toBe("opportunity");
    expect(neglect.impactPnl.greaterThan(0)).toBe(true);
    expect(neglect.suggestedRule).toEqual({ kind: "CUSTOM", title: "Look for Breakout first" });
  });
});
