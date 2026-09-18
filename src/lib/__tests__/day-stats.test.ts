import { describe, expect, it } from "vitest";
import type { BreakdownTrade } from "@/lib/breakdowns";
import { bucketByState, plannedVsUnplanned, sleepBucket, type DayState } from "@/lib/day-stats";

let n = 0;
function t(entryAt: string, pnl: string): BreakdownTrade {
  n++;
  return {
    id: `t${n}`,
    symbol: "X",
    assetClass: "STOCK",
    side: "LONG",
    accountName: "Main",
    status: "CLOSED",
    pnl,
    rMultiple: null,
    plannedRisk: null,
    quantity: "1",
    entryPrice: "1",
    multiplier: "1",
    entryAt: new Date(entryAt),
    exitAt: new Date(entryAt),
  };
}

const days: DayState[] = [
  { date: "2026-09-14", mood: 2, sleepHours: 5.5, focus: 3, energy: 2, checkedIn: true, hasPlan: true },
  { date: "2026-09-15", mood: 4, sleepHours: 7.5, focus: 5, energy: 4, checkedIn: true, hasPlan: false },
  { date: "2026-09-16", mood: null, sleepHours: null, focus: null, energy: null, checkedIn: false, hasPlan: false },
];

const trades = [
  t("2026-09-14T14:00:00Z", "-100"),
  t("2026-09-14T15:00:00Z", "-20"),
  t("2026-09-15T14:00:00Z", "150"),
  t("2026-09-16T14:00:00Z", "30"),
  t("2026-09-17T14:00:00Z", "10"), // no day record
];

describe("day-state buckets", () => {
  it("buckets by mood and by sleep, skipping days without a reading", () => {
    const mood = bucketByState(trades, days, "UTC", "mood");
    expect(mood.map((b) => [b.label, b.tradeCount, b.netPnl.toFixed()])).toEqual([
      ["2", 2, "-120"],
      ["4", 1, "150"],
    ]);
    const sleep = bucketByState(trades, days, "UTC", "sleep");
    expect(sleep.map((b) => [b.label, b.tradeCount])).toEqual([
      ["Under 6h", 2],
      ["7–8h", 1],
    ]);
    expect(sleepBucket(8).label).toBe("8h or more");
    expect(sleepBucket(6.5).label).toBe("6–7h");
    expect(bucketByState([], days, "UTC", "focus")).toEqual([]);
  });

  it("splits planned from unplanned days", () => {
    const split = plannedVsUnplanned(trades, days, "UTC");
    expect(split.map((b) => [b.key, b.tradeCount, b.expectancy!.toFixed()])).toEqual([
      ["planned", 2, "-60"],
      ["unplanned", 3, "63.33333333333333333333333333333333333333"],
    ]);
  });
});
