import { describe, expect, it } from "vitest";
import { cappedPnl, threeCurves, type CurveTrade } from "@/lib/curves";
import { Decimal } from "@/lib/decimal";

function t(id: string, exitAt: string, pnl: string | null, r: string | null, risk: string | null, hasMistake = false): CurveTrade {
  return { id, symbol: "X", status: pnl === null ? "OPEN" : "CLOSED", exitAt: pnl === null ? null : new Date(exitAt), pnl, rMultiple: r, plannedRisk: risk, hasMistake };
}

describe("threeCurves", () => {
  it("builds actual, mistakes-removed and stops-honoured curves in exit order", () => {
    const trades = [
      t("c", "2026-01-03T00:00:00Z", "-300", "-3", "100"), // lost 3R on a 1R plan: capped to -100
      t("a", "2026-01-01T00:00:00Z", "200", "2", "100"),
      t("b", "2026-01-02T00:00:00Z", "-50", "-0.5", "100", true), // a mistake
      t("d", "2026-01-04T00:00:00Z", "-80", null, null), // no stop: cannot be capped
      t("open", "2026-01-05T00:00:00Z", null, null, "100"),
    ];
    const curves = threeCurves(trades);
    expect(curves.points.map((p) => p.tradeId)).toEqual(["a", "b", "c", "d"]);
    expect(curves.points.map((p) => p.actual.toFixed())).toEqual(["200", "150", "-150", "-230"]);
    expect(curves.points.map((p) => p.mistakesRemoved.toFixed())).toEqual(["200", "200", "-100", "-180"]);
    expect(curves.points.map((p) => p.stopsHonoured.toFixed())).toEqual(["200", "150", "50", "-30"]);
    expect(curves.actual.toFixed()).toBe("-230");
    expect(curves.mistakesRemoved.toFixed()).toBe("-180");
    expect(curves.stopsHonoured.toFixed()).toBe("-30");
    expect(curves.removedCount).toBe(1);
    expect(curves.cappedCount).toBe(1);
    expect(curves.points[1].removed).toBe(true);
    expect(curves.points[2].capped).toBe(true);
    // R curves: a (2), b (-0.5, mistake), c (-3 capped to -1), d (no stop, ignored)
    expect(curves.actualR.toFixed()).toBe("-1.5");
    expect(curves.mistakesRemovedR.toFixed()).toBe("-1");
    expect(curves.stopsHonouredR.toFixed()).toBe("0.5");
    expect(curves.points.map((p) => p.stopsHonouredR.toFixed())).toEqual(["2", "1.5", "0.5", "0.5"]);
  });

  it("handles empty input and a single trade", () => {
    const empty = threeCurves([]);
    expect(empty.points).toEqual([]);
    expect(empty.actual.toFixed()).toBe("0");
    const one = threeCurves([t("a", "2026-01-01T00:00:00Z", "-150", "-1.5", "100")]);
    expect(one.points).toHaveLength(1);
    expect(one.stopsHonoured.toFixed()).toBe("-100");
    expect(one.cappedCount).toBe(1);
  });

  it("only caps losses beyond one planned risk", () => {
    const risk = new Decimal(100);
    expect(cappedPnl(new Decimal(-100), risk, new Decimal(-1)).capped).toBe(false);
    expect(cappedPnl(new Decimal(-101), risk, new Decimal(-1.01))).toEqual({ pnl: new Decimal(-100), capped: true });
    expect(cappedPnl(new Decimal(50), risk, new Decimal(0.5)).capped).toBe(false);
    expect(cappedPnl(new Decimal(-500), null, null).capped).toBe(false);
    expect(cappedPnl(new Decimal(-500), new Decimal(0), new Decimal(-5)).capped).toBe(false);
  });
});
