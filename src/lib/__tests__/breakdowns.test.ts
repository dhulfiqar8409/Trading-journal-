import { describe, expect, it } from "vitest";
import { byAccount, byDayOfWeek, byHoldDuration, byHourOfDay, byInstrument, bySide, bySizeBucket, rDistribution, type BreakdownTrade } from "@/lib/breakdowns";

let n = 0;
function t(entryAt: string, pnl: string | null, extra: Partial<BreakdownTrade> = {}): BreakdownTrade {
  n++;
  const entry = new Date(entryAt);
  return {
    id: `t${n}`,
    symbol: "X",
    assetClass: "STOCK",
    side: "LONG",
    accountName: "Main",
    status: pnl === null ? "OPEN" : "CLOSED",
    pnl,
    rMultiple: null,
    plannedRisk: null,
    quantity: "10",
    entryPrice: "100",
    multiplier: "1",
    entryAt: entry,
    exitAt: pnl === null ? null : new Date(entry.getTime() + 30 * 60000),
    ...extra,
  };
}

describe("breakdowns", () => {
  const trades = [
    t("2026-09-14T13:35:00Z", "100", { rMultiple: "2", plannedRisk: "50", side: "LONG" }), // Mon 09:35 NY
    t("2026-09-14T14:10:00Z", "-40", { rMultiple: "-0.8", plannedRisk: "50", side: "SHORT" }), // Mon 10:10
    t("2026-09-15T13:40:00Z", "60", { rMultiple: "1.2", plannedRisk: "50", assetClass: "FUTURES", accountName: "Futures" }), // Tue 09:40
    t("2026-09-18T19:30:00Z", "-90", { rMultiple: "-1.8", plannedRisk: "50", exitAt: new Date("2026-09-19T20:00:00Z") }), // Fri 15:30, held > 1 day
    t("2026-09-18T20:00:00Z", null), // open
  ];

  it("buckets by hour and weekday in the owner's zone", () => {
    const hours = byHourOfDay(trades, "America/New_York");
    expect(hours.map((b) => [b.label, b.tradeCount])).toEqual([
      ["09:00", 2],
      ["10:00", 1],
      ["15:00", 1],
    ]);
    expect(hours[0].netPnl.toFixed()).toBe("160");
    expect(hours[0].expectancy!.toFixed()).toBe("80");
    expect(hours[0].winRate!.toFixed()).toBe("1");
    expect(hours[0].expectancyR!.toFixed()).toBe("1.6");
    const days = byDayOfWeek(trades, "America/New_York");
    expect(days.map((b) => b.label)).toEqual(["Monday", "Tuesday", "Friday"]);
    expect(days[0].tradeCount).toBe(2);
    expect(byDayOfWeek(trades, "UTC")[0].label).toBe("Monday");
  });

  it("buckets by hold duration, size, instrument, side and account", () => {
    const hold = byHoldDuration(trades);
    expect(hold.map((b) => [b.label, b.tradeCount])).toEqual([
      ["15–60 min", 3],
      ["Over a day", 1],
    ]);
    const size = bySizeBucket(trades);
    expect(size.basis).toBe("risk");
    expect(size.buckets.reduce((acc, b) => acc + b.tradeCount, 0)).toBe(4);
    const notionalBased = bySizeBucket(trades.map((x) => ({ ...x, plannedRisk: null })));
    expect(notionalBased.basis).toBe("notional");
    expect(byInstrument(trades).map((b) => [b.key, b.tradeCount])).toEqual([
      ["STOCK", 3],
      ["FUTURES", 1],
    ]);
    expect(bySide(trades).map((b) => [b.label, b.tradeCount])).toEqual([
      ["Long", 3],
      ["Short", 1],
    ]);
    expect(byAccount(trades).map((b) => [b.key, b.tradeCount])).toEqual([
      ["Futures", 1],
      ["Main", 3],
    ]);
  });

  it("builds an R histogram over trades with stops only", () => {
    const { bins, total } = rDistribution([...trades, t("2026-09-20T13:00:00Z", "5")]);
    expect(total).toBe(4);
    const counts = Object.fromEntries(bins.map((b) => [b.label, b.count]));
    expect(counts["1 to 2R"]).toBe(1);
    expect(counts["2 to 3R"]).toBe(1);
    expect(counts["-1 to -0.5R"]).toBe(1);
    expect(counts["-2 to -1R"]).toBe(1);
    expect(rDistribution([]).total).toBe(0);
  });

  it("returns empty breakdowns for empty input", () => {
    expect(byHourOfDay([], "UTC")).toEqual([]);
    expect(bySizeBucket([]).buckets).toEqual([]);
  });
});
