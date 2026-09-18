import { describe, expect, it } from "vitest";
import { hasMistake, mistakeCosts, type MistakeTrade } from "@/lib/mistakes";

const fomo = { id: "m1", name: "FOMO", kind: "MISTAKE" };
const chased = { id: "m2", name: "Chased entry", kind: "MISTAKE" };
const breakout = { id: "s1", name: "Breakout", kind: "SETUP" };

function t(id: string, pnl: string | null, r: string | null, tags: MistakeTrade["tags"], status: "OPEN" | "CLOSED" = "CLOSED"): MistakeTrade {
  return { id, status, pnl, rMultiple: r, tags };
}

describe("mistakeCosts", () => {
  it("ranks mistake tags by the P&L of the trades carrying them", () => {
    const trades = [
      t("1", "-120", "-1.2", [fomo, breakout]),
      t("2", "-80", null, [fomo, chased]),
      t("3", "40", "0.5", [chased]),
      t("4", "500", "2", [breakout]),
      t("5", null, null, [fomo], "OPEN"),
    ];
    const costs = mistakeCosts(trades);
    expect(costs.map((c) => c.name)).toEqual(["FOMO", "Chased entry"]);
    expect(costs[0].count).toBe(2);
    expect(costs[0].netPnl.toFixed()).toBe("-200");
    expect(costs[0].avgPnl!.toFixed()).toBe("-100");
    expect(costs[0].netR.toFixed()).toBe("-1.2");
    expect(costs[0].rCount).toBe(1);
    expect(costs[1].netPnl.toFixed()).toBe("-40");
  });

  it("counts a tag once per trade and ignores non-mistake tags, open trades and empty input", () => {
    expect(mistakeCosts([])).toEqual([]);
    expect(mistakeCosts([t("1", "10", null, [breakout])])).toEqual([]);
    const dup = mistakeCosts([t("1", "-10", null, [fomo, fomo])]);
    expect(dup[0].count).toBe(1);
    expect(hasMistake(t("1", "1", null, [breakout]))).toBe(false);
    expect(hasMistake(t("1", "1", null, [breakout, fomo]))).toBe(true);
  });
});
