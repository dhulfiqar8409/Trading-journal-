import { describe, expect, it } from "vitest";
import { edgeDecay, meanBand, type DecayTrade } from "@/lib/edge-decay";

let n = 0;
function t(r: string | null, setupIds: string[], status: "OPEN" | "CLOSED" = "CLOSED"): DecayTrade {
  n++;
  return { id: `t${String(n).padStart(3, "0")}`, exitAt: status === "CLOSED" ? new Date(Date.UTC(2026, 0, 1, 0, 0, 0, n)) : null, status, rMultiple: r, setupIds };
}

const setups = [
  { id: "a", name: "Breakout" },
  { id: "b", name: "Pullback" },
];

describe("edgeDecay", () => {
  it("computes a rolling mean with a 95% band", () => {
    expect(meanBand([])).toEqual({ mean: 0, lower: 0, upper: 0, n: 0 });
    expect(meanBand([2])).toEqual({ mean: 2, lower: 2, upper: 2, n: 1 });
    const band = meanBand([1, 3]);
    expect(band.mean).toBe(2);
    expect(band.upper - band.lower).toBeCloseTo(2 * 1.96 * Math.SQRT2 / Math.SQRT2, 5);
  });

  it("flags a setup whose rolling expectancy crossed below zero", () => {
    const trades: DecayTrade[] = [];
    for (let i = 0; i < 8; i++) trades.push(t("1.5", ["a"]));
    for (let i = 0; i < 12; i++) trades.push(t("-1", ["a"]));
    trades.push(t("2", ["b"]), t("1", ["b"]), t("0.5", ["b"]), t("1", ["b"]), t("3", ["b"]));
    const result = edgeDecay(trades, setups, { window: 5, minimum: 5 });
    const breakout = result.find((s) => s.setupId === "a")!;
    const pullback = result.find((s) => s.setupId === "b")!;
    expect(breakout.tradeCount).toBe(20);
    expect(breakout.points[0].mean).toBeCloseTo(1.5);
    expect(breakout.latest!.mean).toBeCloseTo(-1);
    expect(breakout.crossedBelowZero).toBe(true);
    expect(breakout.suggestion).toMatch(/Paper-trade/);
    expect(pullback.crossedBelowZero).toBe(false);
    expect(pullback.suggestion).toBeNull();
    expect(pullback.latest!.mean).toBeCloseTo(1.5);
    expect(result[0].setupId).toBe("a"); // worst first
  });

  it("ignores trades without a stop or still open, and needs the minimum sample", () => {
    const trades = [t(null, ["a"]), t("1", ["a"], "OPEN"), t("1", ["a"]), t("1", ["a"])];
    const [breakout] = edgeDecay(trades, [setups[0]], { minimum: 3 });
    expect(breakout.tradeCount).toBe(2);
    expect(breakout.points).toEqual([]);
    expect(breakout.latest).toBeNull();
    expect(breakout.crossedBelowZero).toBe(false);
    expect(edgeDecay([], setups)).toHaveLength(2);
  });

  it("reports a negative rolling expectancy that never was positive without the paper-trade flag", () => {
    const trades = Array.from({ length: 6 }, () => t("-0.5", ["a"]));
    const [breakout] = edgeDecay(trades, [setups[0]], { minimum: 5 });
    expect(breakout.crossedBelowZero).toBe(false);
    expect(breakout.suggestion).toMatch(/negative/);
  });
});
