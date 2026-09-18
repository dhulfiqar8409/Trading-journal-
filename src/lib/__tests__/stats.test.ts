import { describe, expect, it } from "vitest";
import {
  breakdownBySymbol,
  breakdownByTag,
  closedTrades,
  currentStreak,
  dailyPnl,
  equityCurve,
  maxDrawdown,
  summarize,
  type StatsTrade,
} from "@/lib/stats";

let seq = 0;
function trade(pnl: string | null, exitAt: string | null, extra: Partial<StatsTrade> = {}): StatsTrade {
  seq++;
  return {
    id: `t${seq}`,
    symbol: "AAPL",
    status: exitAt ? "CLOSED" : "OPEN",
    pnl,
    entryAt: new Date(exitAt ?? "2024-01-01T10:00:00Z"),
    exitAt: exitAt ? new Date(exitAt) : null,
    ...extra,
  };
}

const sample: StatsTrade[] = [
  trade("100", "2024-01-02T15:00:00Z", { symbol: "AAPL", tags: ["Breakout"] }),
  trade("-50", "2024-01-03T15:00:00Z", { symbol: "MSFT", tags: ["Breakout", "FOMO"] }),
  trade("300", "2024-01-03T18:00:00Z", { symbol: "AAPL", tags: ["Pullback"] }),
  trade("-150", "2024-01-05T15:00:00Z", { symbol: "TSLA" }),
  trade("0", "2024-01-08T15:00:00Z", { symbol: "TSLA" }),
  trade("40", "2024-01-09T15:00:00Z", { symbol: "MSFT", tags: ["Pullback"] }),
  trade(null, null, { symbol: "NVDA" }), // open trade, must be ignored
];

describe("summarize", () => {
  it("handles an empty set", () => {
    const s = summarize([]);
    expect(s.tradeCount).toBe(0);
    expect(s.netPnl.toFixed()).toBe("0");
    expect(s.grossProfit.toFixed()).toBe("0");
    expect(s.grossLoss.toFixed()).toBe("0");
    expect(s.winRate).toBeNull();
    expect(s.profitFactor).toBeNull();
    expect(s.avgWin).toBeNull();
    expect(s.avgLoss).toBeNull();
    expect(s.expectancy).toBeNull();
    expect(s.largestWin).toBeNull();
    expect(s.largestLoss).toBeNull();
    expect(s.maxDrawdown.toFixed()).toBe("0");
    expect(s.streak).toEqual({ kind: "NONE", length: 0 });
  });

  it("ignores open trades and trades without a P&L", () => {
    const s = summarize([trade(null, null), trade("5", null), { ...trade("7", "2024-01-01T00:00:00Z"), pnl: null }]);
    expect(s.tradeCount).toBe(0);
    expect(s.openCount).toBe(2);
  });

  it("computes the headline numbers", () => {
    const s = summarize(sample);
    expect(s.tradeCount).toBe(6);
    expect(s.openCount).toBe(1);
    expect(s.wins).toBe(3);
    expect(s.losses).toBe(2);
    expect(s.breakeven).toBe(1);
    expect(s.netPnl.toFixed()).toBe("240");
    expect(s.grossProfit.toFixed()).toBe("440");
    expect(s.grossLoss.toFixed()).toBe("-200");
    expect(s.winRate!.toFixed(4)).toBe("0.5000");
    expect(s.profitFactor!.toFixed(2)).toBe("2.20");
    expect(s.avgWin!.toFixed(4)).toBe("146.6667");
    expect(s.avgLoss!.toFixed()).toBe("-100");
    expect(s.expectancy!.toFixed()).toBe("40");
    expect(s.largestWin!.toFixed()).toBe("300");
    expect(s.largestLoss!.toFixed()).toBe("-150");
  });

  it("matches the classic expectancy formula", () => {
    const s = summarize(sample);
    const winRate = s.winRate!;
    const lossRate = winRate.constructor === Object ? null : s.losses / s.tradeCount;
    const expected = winRate.times(s.avgWin!).plus(s.avgLoss!.times(lossRate!));
    expect(s.expectancy!.toFixed(8)).toBe(expected.toFixed(8));
  });

  it("returns a null profit factor when there are no losing trades", () => {
    const s = summarize([trade("10", "2024-01-01T00:00:00Z"), trade("20", "2024-01-02T00:00:00Z")]);
    expect(s.profitFactor).toBeNull();
    expect(s.avgLoss).toBeNull();
    expect(s.winRate!.toFixed()).toBe("1");
  });

  it("uses exact decimal arithmetic", () => {
    const s = summarize([trade("0.1", "2024-01-01T00:00:00Z"), trade("0.2", "2024-01-02T00:00:00Z")]);
    expect(s.netPnl.toFixed()).toBe("0.3");
  });
});

describe("R-based aggregates", () => {
  it("only counts trades with a stop and keeps currency figures for the rest", () => {
    const trades: StatsTrade[] = [
      trade("100", "2024-02-01T00:00:00Z", { rMultiple: "2" }),
      trade("-50", "2024-02-02T00:00:00Z", { rMultiple: "-1" }),
      trade("30", "2024-02-03T00:00:00Z"), // no stop
      trade("-20", "2024-02-04T00:00:00Z", { rMultiple: "-0.5" }),
    ];
    const s = summarize(trades);
    expect(s.tradeCount).toBe(4);
    expect(s.rTradeCount).toBe(3);
    expect(s.netR.toFixed()).toBe("0.5");
    expect(s.expectancyR!.toFixed(4)).toBe("0.1667");
    expect(s.avgWinR!.toFixed()).toBe("2");
    expect(s.avgLossR!.toFixed()).toBe("-0.75");
    expect(s.maxDrawdownR.toFixed()).toBe("1.5");
    const curve = equityCurve(trades);
    expect(curve.map((p) => p.cumulativeR.toFixed())).toEqual(["2", "1", "1", "0.5"]);
    expect(dailyPnl(trades).map((d) => d.r.toFixed())).toEqual(["2", "-1", "0", "-0.5"]);
    expect(breakdownBySymbol(trades)[0].netR.toFixed()).toBe("0.5");
    expect(breakdownBySymbol(trades)[0].rTradeCount).toBe(3);
  });

  it("reports zero R figures when no trade has a stop", () => {
    const s = summarize([trade("10", "2024-02-01T00:00:00Z")]);
    expect(s.rTradeCount).toBe(0);
    expect(s.netR.toFixed()).toBe("0");
    expect(s.expectancyR).toBeNull();
    expect(s.maxDrawdownR.toFixed()).toBe("0");
  });
});

describe("maxDrawdown", () => {
  it("is zero for an empty or all-winning sequence", () => {
    expect(maxDrawdown([]).toFixed()).toBe("0");
    expect(maxDrawdown(["10", "20", "5"]).toFixed()).toBe("0");
  });

  it("measures from a starting equity of zero when the first trades lose", () => {
    expect(maxDrawdown(["-100", "-50", "30"]).toFixed()).toBe("150");
  });

  it("finds the largest peak-to-trough decline, not the final decline", () => {
    // equity: 100, 300, 200, 50, 400, 350
    expect(maxDrawdown(["100", "200", "-100", "-150", "350", "-50"]).toFixed()).toBe("250");
  });

  it("does not reset the peak after a partial recovery", () => {
    // equity: 100, 0, 50, -20 -> peak stays 100, trough -20
    expect(maxDrawdown(["100", "-100", "50", "-70"]).toFixed()).toBe("120");
  });

  it("depends on order", () => {
    expect(maxDrawdown(["-100", "100"]).toFixed()).toBe("100");
    expect(maxDrawdown(["100", "-100"]).toFixed()).toBe("100");
    expect(maxDrawdown(["100", "-40", "-40"]).toFixed()).toBe("80");
  });

  it("uses chronological order regardless of input order in summarize", () => {
    const trades = [trade("50", "2024-01-03T00:00:00Z"), trade("-100", "2024-01-01T00:00:00Z"), trade("-30", "2024-01-02T00:00:00Z")];
    expect(summarize(trades).maxDrawdown.toFixed()).toBe("130");
  });
});

describe("currentStreak", () => {
  it("counts consecutive wins from the most recent trade", () => {
    const closed = closedTrades([
      trade("-1", "2024-01-01T00:00:00Z"),
      trade("5", "2024-01-02T00:00:00Z"),
      trade("6", "2024-01-03T00:00:00Z"),
    ]);
    expect(currentStreak(closed)).toEqual({ kind: "WIN", length: 2 });
  });

  it("counts consecutive losses", () => {
    const closed = closedTrades([
      trade("5", "2024-01-01T00:00:00Z"),
      trade("-1", "2024-01-02T00:00:00Z"),
      trade("-2", "2024-01-03T00:00:00Z"),
      trade("-3", "2024-01-04T00:00:00Z"),
    ]);
    expect(currentStreak(closed)).toEqual({ kind: "LOSS", length: 3 });
  });

  it("is NONE after a breakeven trade", () => {
    const closed = closedTrades([trade("5", "2024-01-01T00:00:00Z"), trade("0", "2024-01-02T00:00:00Z")]);
    expect(currentStreak(closed)).toEqual({ kind: "NONE", length: 0 });
  });

  it("reports the streak from the sample set", () => {
    expect(summarize(sample).streak).toEqual({ kind: "WIN", length: 1 });
  });
});

describe("breakdowns", () => {
  it("groups by symbol sorted by net P&L", () => {
    const rows = breakdownBySymbol(sample);
    expect(rows.map((r) => r.key)).toEqual(["AAPL", "MSFT", "TSLA"]);
    expect(rows[0].netPnl.toFixed()).toBe("400");
    expect(rows[0].tradeCount).toBe(2);
    expect(rows[0].winRate.toFixed()).toBe("1");
    expect(rows[2].netPnl.toFixed()).toBe("-150");
    expect(rows[2].tradeCount).toBe(2);
    expect(rows[2].wins).toBe(0);
  });

  it("groups by tag, counting a trade once per tag", () => {
    const rows = breakdownByTag(sample);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.Breakout.tradeCount).toBe(2);
    expect(byKey.Breakout.netPnl.toFixed()).toBe("50");
    expect(byKey.Pullback.netPnl.toFixed()).toBe("340");
    expect(byKey.FOMO.netPnl.toFixed()).toBe("-50");
    expect(rows[0].key).toBe("Pullback");
    expect(Object.keys(byKey)).toHaveLength(3);
  });

  it("returns empty breakdowns for empty input", () => {
    expect(breakdownBySymbol([])).toEqual([]);
    expect(breakdownByTag([])).toEqual([]);
  });
});

describe("dailyPnl and equityCurve", () => {
  it("buckets by UTC exit day by default", () => {
    const days = dailyPnl(sample);
    expect(days.map((d) => [d.date, d.pnl.toFixed(), d.tradeCount])).toEqual([
      ["2024-01-02", "100", 1],
      ["2024-01-03", "250", 2],
      ["2024-01-05", "-150", 1],
      ["2024-01-08", "0", 1],
      ["2024-01-09", "40", 1],
    ]);
  });

  it("buckets by the requested zone", () => {
    const trades = [trade("10", "2024-01-03T03:00:00Z")]; // 22:00 the previous day in New York
    expect(dailyPnl(trades, { timeZone: "America/New_York" })[0].date).toBe("2024-01-02");
    expect(dailyPnl(trades, { timeZone: "UTC" })[0].date).toBe("2024-01-03");
  });

  it("builds a cumulative curve in exit order", () => {
    const curve = equityCurve(sample);
    expect(curve.map((p) => p.cumulative.toFixed())).toEqual(["100", "50", "350", "200", "200", "240"]);
    expect(curve[0].tradeId).toBe(sample[0].id);
  });

  it("returns empty series for empty input", () => {
    expect(dailyPnl([])).toEqual([]);
    expect(equityCurve([])).toEqual([]);
  });
});
