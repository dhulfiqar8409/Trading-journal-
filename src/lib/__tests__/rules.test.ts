import { describe, expect, it } from "vitest";
import { describeRule, evaluateRule, evaluateRules, type RuleLike, type RuleTrade } from "@/lib/rules";

function rule(kind: RuleLike["kind"], value: string | null = null, timeValue: string | null = null, active = true): RuleLike {
  return { id: `r-${kind}`, title: kind, kind, value, timeValue, active };
}

function trade(id: string, entryAt: string, extra: Partial<RuleTrade> = {}): RuleTrade {
  return {
    id,
    entryAt: new Date(entryAt),
    exitAt: extra.exitAt === undefined ? new Date(new Date(entryAt).getTime() + 30 * 60000) : extra.exitAt,
    status: extra.status ?? "CLOSED",
    quantity: extra.quantity ?? "100",
    stopPrice: extra.stopPrice === undefined ? "99" : extra.stopPrice,
    pnl: extra.pnl === undefined ? "10" : extra.pnl,
    rMultiple: extra.rMultiple === undefined ? "0.5" : extra.rMultiple,
  };
}

const tz = "America/New_York";

describe("evaluateRule", () => {
  it("counts trades per day in chronological order", () => {
    const a = trade("a", "2026-09-14T13:35:00Z");
    const b = trade("b", "2026-09-14T14:00:00Z");
    const c = trade("c", "2026-09-14T15:00:00Z");
    const ctx = { timeZone: tz, dayTrades: [c, a, b] };
    const r = rule("MAX_TRADES_PER_DAY", "2");
    expect(evaluateRule(r, a, ctx).status).toBe("FOLLOWED");
    expect(evaluateRule(r, b, ctx).status).toBe("FOLLOWED");
    expect(evaluateRule(r, c, ctx)).toEqual({ status: "BROKEN", detail: "trade 3 of the day, limit 2" });
    expect(evaluateRule(rule("MAX_TRADES_PER_DAY"), c, ctx).status).toBe("NOT_APPLICABLE");
  });

  it("flags trades opened after the daily loss limit was hit, in R and in currency", () => {
    const loser = trade("l", "2026-09-14T13:35:00Z", { pnl: "-250", rMultiple: "-2.5", exitAt: new Date("2026-09-14T13:50:00Z") });
    const next = trade("n", "2026-09-14T14:00:00Z");
    const stillOpen = trade("o", "2026-09-14T13:40:00Z", { status: "OPEN", exitAt: null, pnl: null, rMultiple: null });
    const ctx = { timeZone: tz, dayTrades: [loser, next, stillOpen] };
    expect(evaluateRule(rule("MAX_DAILY_LOSS_R", "2"), next, ctx).status).toBe("BROKEN");
    expect(evaluateRule(rule("MAX_DAILY_LOSS_R", "3"), next, ctx).status).toBe("FOLLOWED");
    expect(evaluateRule(rule("MAX_DAILY_LOSS_USD", "200"), next, ctx).status).toBe("BROKEN");
    expect(evaluateRule(rule("MAX_DAILY_LOSS_USD", "300"), next, ctx).status).toBe("FOLLOWED");
    // The losing trade itself was opened before any loss existed.
    expect(evaluateRule(rule("MAX_DAILY_LOSS_R", "2"), loser, ctx).status).toBe("FOLLOWED");
    // Losses realised after this trade was opened do not count.
    const early = trade("e", "2026-09-14T13:30:00Z");
    expect(evaluateRule(rule("MAX_DAILY_LOSS_R", "2"), early, { ...ctx, dayTrades: [...ctx.dayTrades, early] }).status).toBe("FOLLOWED");
  });

  it("checks wall-clock entry times in the owner's zone", () => {
    const t = trade("t", "2026-09-14T13:35:00Z"); // 09:35 New York
    const ctx = { timeZone: tz, dayTrades: [t] };
    expect(evaluateRule(rule("NO_TRADES_BEFORE", null, "09:45"), t, ctx)).toEqual({ status: "BROKEN", detail: "entered at 09:35, before 09:45" });
    expect(evaluateRule(rule("NO_TRADES_BEFORE", null, "09:30"), t, ctx).status).toBe("FOLLOWED");
    expect(evaluateRule(rule("NO_TRADES_AFTER", null, "09:35"), t, ctx).status).toBe("BROKEN");
    expect(evaluateRule(rule("NO_TRADES_AFTER", null, "15:30"), t, ctx).status).toBe("FOLLOWED");
    expect(evaluateRule(rule("NO_TRADES_AFTER", null, "15:30"), t, { ...ctx, timeZone: "UTC" }).status).toBe("FOLLOWED");
    expect(evaluateRule(rule("NO_TRADES_BEFORE", null, "14:00"), t, { ...ctx, timeZone: "UTC" }).status).toBe("BROKEN");
    expect(evaluateRule(rule("NO_TRADES_BEFORE", null, "25:00"), t, ctx).status).toBe("NOT_APPLICABLE");
  });

  it("requires stops, caps losses per trade and limits size", () => {
    const withStop = trade("s", "2026-09-14T13:35:00Z");
    const noStop = trade("n", "2026-09-14T13:35:00Z", { stopPrice: null, rMultiple: null });
    const ctx = { timeZone: tz, dayTrades: [withStop, noStop] };
    expect(evaluateRule(rule("STOP_REQUIRED"), withStop, ctx).status).toBe("FOLLOWED");
    expect(evaluateRule(rule("STOP_REQUIRED"), noStop, ctx).status).toBe("BROKEN");

    const blown = trade("b", "2026-09-14T13:35:00Z", { rMultiple: "-1.8" });
    expect(evaluateRule(rule("MAX_RISK_PER_TRADE_R", "1"), blown, ctx)).toEqual({ status: "BROKEN", detail: "lost 1.8R, limit 1R" });
    expect(evaluateRule(rule("MAX_RISK_PER_TRADE_R", "2"), blown, ctx).status).toBe("FOLLOWED");
    expect(evaluateRule(rule("MAX_RISK_PER_TRADE_R", "1"), noStop, ctx).status).toBe("NOT_APPLICABLE");
    const open = trade("o", "2026-09-14T13:35:00Z", { status: "OPEN", exitAt: null, pnl: null, rMultiple: null });
    expect(evaluateRule(rule("MAX_RISK_PER_TRADE_R", "1"), open, ctx).status).toBe("NOT_APPLICABLE");

    expect(evaluateRule(rule("MAX_POSITION_SIZE", "100"), withStop, ctx).status).toBe("FOLLOWED");
    expect(evaluateRule(rule("MAX_POSITION_SIZE", "99"), withStop, ctx).status).toBe("BROKEN");
    expect(evaluateRule(rule("CUSTOM"), withStop, ctx).status).toBe("NOT_APPLICABLE");
  });
});

describe("evaluateRules", () => {
  it("skips inactive, custom and non-applicable rules", () => {
    const t = trade("t", "2026-09-14T13:35:00Z", { stopPrice: null, rMultiple: null });
    const rules: RuleLike[] = [
      rule("STOP_REQUIRED"),
      { ...rule("MAX_POSITION_SIZE", "50"), active: false },
      rule("CUSTOM"),
      rule("MAX_RISK_PER_TRADE_R", "1"),
      rule("MAX_TRADES_PER_DAY", "5"),
    ];
    const result = evaluateRules(rules, t, { timeZone: tz, dayTrades: [t] });
    expect(result.map((r) => [r.ruleId, r.status])).toEqual([
      ["r-STOP_REQUIRED", "BROKEN"],
      ["r-MAX_TRADES_PER_DAY", "FOLLOWED"],
    ]);
  });

  it("describes rule parameters", () => {
    expect(describeRule(rule("MAX_TRADES_PER_DAY", "3"))).toBe("3 trades");
    expect(describeRule(rule("MAX_DAILY_LOSS_R", "2"))).toBe("2R");
    expect(describeRule(rule("NO_TRADES_AFTER", null, "15:30"))).toBe("15:30");
    expect(describeRule(rule("STOP_REQUIRED"))).toBe("");
  });
});
