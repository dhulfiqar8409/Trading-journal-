import { describe, expect, it } from "vitest";
import { adherenceSplit, hasBrokenRule, overallAdherence, ruleCosts, weeklyAdherence, type AdherenceTrade } from "@/lib/adherence";

function t(id: string, entryAt: string, pnl: string | null, r: string | null, events: AdherenceTrade["events"]): AdherenceTrade {
  return { id, entryAt: new Date(entryAt), exitAt: pnl === null ? null : new Date(entryAt), status: pnl === null ? "OPEN" : "CLOSED", pnl, rMultiple: r, events };
}

const F = { ruleId: "stop", status: "FOLLOWED" as const };
const B = { ruleId: "stop", status: "BROKEN" as const, justification: "chased" };
const O = { ruleId: "time", status: "OVERRIDDEN" as const };

const trades: AdherenceTrade[] = [
  t("1", "2026-09-14T14:00:00Z", "100", "2", [F, { ruleId: "time", status: "FOLLOWED" }]),
  t("2", "2026-09-15T14:00:00Z", "-80", "-1", [B, { ruleId: "time", status: "FOLLOWED" }]),
  t("3", "2026-09-16T14:00:00Z", "-40", null, [F, O]),
  t("4", "2026-09-22T14:00:00Z", "60", "1.5", [F]),
  t("5", "2026-09-23T14:00:00Z", null, null, [B]), // open, still counts for adherence
];

describe("adherence", () => {
  it("detects broken and overridden rules", () => {
    expect(hasBrokenRule(trades[0])).toBe(false);
    expect(hasBrokenRule(trades[1])).toBe(true);
    expect(hasBrokenRule(trades[2])).toBe(true);
  });

  it("computes overall adherence", () => {
    const o = overallAdherence(trades);
    expect(o.total).toBe(8);
    expect(o.followed).toBe(5);
    expect(o.adherence!.toFixed(4)).toBe("0.6250");
    expect(overallAdherence([]).adherence).toBeNull();
  });

  it("splits results by clean versus rule-breaking trades", () => {
    const { clean, broken } = adherenceSplit(trades);
    expect(clean.tradeCount).toBe(2);
    expect(clean.netPnl.toFixed()).toBe("160");
    expect(clean.expectancy!.toFixed()).toBe("80");
    expect(clean.winRate!.toFixed()).toBe("1");
    expect(clean.netR.toFixed()).toBe("3.5");
    expect(clean.expectancyR!.toFixed()).toBe("1.75");
    expect(broken.tradeCount).toBe(3);
    expect(broken.closedCount).toBe(2);
    expect(broken.netPnl.toFixed()).toBe("-120");
    expect(broken.expectancy!.toFixed()).toBe("-60");
    expect(broken.winRate!.toFixed()).toBe("0");
    expect(broken.rCount).toBe(1);
    expect(broken.expectancyR!.toFixed()).toBe("-1");
  });

  it("handles empty input", () => {
    const { clean, broken } = adherenceSplit([]);
    expect(clean.tradeCount).toBe(0);
    expect(clean.expectancy).toBeNull();
    expect(broken.winRate).toBeNull();
    expect(weeklyAdherence([], "UTC")).toEqual([]);
    expect(ruleCosts([])).toEqual([]);
  });

  it("buckets adherence by ISO week", () => {
    const weeks = weeklyAdherence(trades, "UTC");
    expect(weeks.map((w) => w.week)).toEqual(["2026-W38", "2026-W39"]);
    expect(weeks[0].total).toBe(6);
    expect(weeks[0].followed).toBe(4);
    expect(weeks[0].tradeCount).toBe(3);
    expect(weeks[0].cleanTrades).toBe(1);
    expect(weeks[1].adherence!.toFixed(2)).toBe("0.50");
  });

  it("ranks the cost of each broken rule", () => {
    const costs = ruleCosts(trades);
    expect(costs.map((c) => c.ruleId)).toEqual(["stop", "time"]);
    expect(costs[0].brokenCount).toBe(2);
    expect(costs[0].netPnl.toFixed()).toBe("-80");
    expect(costs[0].avgPnl!.toFixed()).toBe("-40");
    expect(costs[0].netR.toFixed()).toBe("-1");
    expect(costs[1].netPnl.toFixed()).toBe("-40");
    expect(costs[1].rCount).toBe(0);
  });
});
