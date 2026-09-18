import { describe, expect, it } from "vitest";
import { edgeScore, edgeScoreTrend, scoreWindow, type ScoreTrade } from "@/lib/edge-score";

let n = 0;
function t(pnl: string, day = 1): ScoreTrade {
  n++;
  return { id: `t${String(n).padStart(3, "0")}`, exitAt: new Date(Date.UTC(2026, 0, day, 12, 0, 0, n)), pnl };
}

describe("edgeScore", () => {
  it("is insufficient below the minimum sample and empty input", () => {
    expect(edgeScore([]).insufficient).toBe(true);
    expect(edgeScore([]).score).toBeNull();
    const nine = Array.from({ length: 9 }, (_, i) => t("10", i + 1));
    expect(edgeScore(nine).insufficient).toBe(true);
    expect(edgeScore(nine, { minimum: 5 }).insufficient).toBe(false);
  });

  it("scores a perfect window at 100 and a hopeless one at 0", () => {
    const winners = Array.from({ length: 12 }, (_, i) => t("100", i + 1));
    const perfect = edgeScore(winners);
    expect(perfect.score).toBe(100);
    expect(perfect.factors.every((f) => f.score === 100)).toBe(true);
    const losers = Array.from({ length: 12 }, (_, i) => t("-100", i + 1));
    expect(edgeScore(losers).score).toBe(0);
  });

  it("applies the documented anchors", () => {
    // 10 trades: 5 wins of 200, 5 losses of 100 => win rate 50%, PF 2, payoff 2, net 500.
    const trades: ScoreTrade[] = [];
    for (let i = 0; i < 5; i++) {
      trades.push(t("200", i + 1));
      trades.push(t("-100", i + 1));
    }
    const factors = scoreWindow(trades);
    const byKey = Object.fromEntries(factors.map((f) => [f.key, f]));
    expect(byKey.winRate.raw).toBeCloseTo(0.5);
    expect(byKey.winRate.score).toBeCloseTo(60); // (0.5-0.2)/(0.7-0.2)
    expect(byKey.profitFactor.raw).toBeCloseTo(2);
    expect(byKey.profitFactor.score).toBeCloseTo(60); // (2-0.5)/2.5
    expect(byKey.payoff.raw).toBeCloseTo(2);
    expect(byKey.payoff.score).toBeCloseTo(60);
    // cumulative: 200,100,300,200,500,400,700,600,900,800 -> max drawdown 100; gross profit 1000
    expect(byKey.drawdown.raw).toBeCloseTo(0.1);
    expect(byKey.drawdown.score).toBeCloseTo(90);
    expect(byKey.recovery.raw).toBeCloseTo(5);
    expect(byKey.recovery.score).toBeCloseTo(100);
    // each day nets 100 of 500 => best day share 0.2 -> (0.6-0.2)/0.5 = 80
    expect(byKey.consistency.raw).toBeCloseTo(0.2);
    expect(byKey.consistency.score).toBeCloseTo(80);
    expect(edgeScore(trades).score).toBe(Math.round((60 + 60 + 60 + 90 + 100 + 80) / 6));
  });

  it("uses only the most recent window of trades", () => {
    const old = Array.from({ length: 20 }, (_, i) => t("-100", i + 1));
    const recent = Array.from({ length: 10 }, (_, i) => t("100", i + 21));
    const score = edgeScore([...old, ...recent], { window: 10 });
    expect(score.sampleSize).toBe(10);
    expect(score.score).toBe(100);
  });

  it("produces a trend sampled every step trades and always ending at the last trade", () => {
    const trades = Array.from({ length: 23 }, (_, i) => t(i % 3 === 0 ? "-50" : "80", i + 1));
    const trend = edgeScoreTrend(trades, { step: 5, window: 10 });
    expect(trend.map((p) => p.index)).toEqual([10, 15, 20, 23]);
    expect(trend.every((p) => p.score >= 0 && p.score <= 100)).toBe(true);
    expect(edgeScoreTrend([])).toEqual([]);
  });
});
