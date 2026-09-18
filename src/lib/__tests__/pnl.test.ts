import { describe, expect, it } from "vitest";
import { Decimal } from "@/lib/decimal";
import {
  computeTradeMetrics,
  exitPriceForNetPnl,
  grossPnl,
  netPnl,
  plannedRewardRisk,
  riskAmount,
  rMultiple,
} from "@/lib/pnl";

const str = (d: Decimal | null) => (d === null ? null : d.toFixed());

describe("netPnl", () => {
  it("computes a long winner", () => {
    expect(str(netPnl({ side: "LONG", quantity: 100, entryPrice: "10", exitPrice: "12" }))).toBe("200");
  });

  it("computes a long loser", () => {
    expect(str(netPnl({ side: "LONG", quantity: 100, entryPrice: "10", exitPrice: "9.5" }))).toBe("-50");
  });

  it("inverts the sign for short trades", () => {
    expect(str(netPnl({ side: "SHORT", quantity: 100, entryPrice: "10", exitPrice: "12" }))).toBe("-200");
    expect(str(netPnl({ side: "SHORT", quantity: 100, entryPrice: "10", exitPrice: "9" }))).toBe("100");
  });

  it("subtracts fees from both winners and losers", () => {
    expect(str(netPnl({ side: "LONG", quantity: 10, entryPrice: "100", exitPrice: "101", fees: "2.5" }))).toBe("7.5");
    expect(str(netPnl({ side: "SHORT", quantity: 10, entryPrice: "100", exitPrice: "101", fees: "2.5" }))).toBe("-12.5");
  });

  it("applies the multiplier for futures and options", () => {
    // ES futures: 50 USD per point, 2 contracts, 4 points.
    expect(str(netPnl({ side: "LONG", quantity: 2, entryPrice: "5000", exitPrice: "5004", multiplier: 50, fees: "4.2" }))).toBe("395.8");
    // Options: 100 shares per contract.
    expect(str(netPnl({ side: "SHORT", quantity: 3, entryPrice: "1.20", exitPrice: "0.70", multiplier: 100 }))).toBe("150");
  });

  it("returns null while the trade is open", () => {
    expect(netPnl({ side: "LONG", quantity: 1, entryPrice: "10" })).toBeNull();
    expect(netPnl({ side: "LONG", quantity: 1, entryPrice: "10", exitPrice: null })).toBeNull();
    expect(grossPnl({ side: "LONG", quantity: 1, entryPrice: "10", exitPrice: undefined })).toBeNull();
  });

  it("is exact with decimal inputs that break floating point", () => {
    expect(str(netPnl({ side: "LONG", quantity: 3, entryPrice: "0.1", exitPrice: "0.2" }))).toBe("0.3");
    expect(str(netPnl({ side: "LONG", quantity: "0.5", entryPrice: "43210.12345678", exitPrice: "43310.12345678" }))).toBe("50");
  });

  it("accepts decimal-like objects such as Prisma decimals", () => {
    const like = { toString: () => "12.5" };
    expect(str(netPnl({ side: "LONG", quantity: like, entryPrice: "1", exitPrice: "2" }))).toBe("12.5");
  });

  it("treats a zero gross P&L as closed, not open", () => {
    const metrics = computeTradeMetrics({ side: "LONG", quantity: 1, entryPrice: "10", exitPrice: "10", fees: "1" });
    expect(metrics.status).toBe("CLOSED");
    expect(str(metrics.grossPnl)).toBe("0");
    expect(str(metrics.pnl)).toBe("-1");
  });
});

describe("risk and R-multiple", () => {
  it("computes risk from the stop distance", () => {
    expect(str(riskAmount({ side: "LONG", quantity: 100, entryPrice: "10", stopPrice: "9.5" }))).toBe("50");
    expect(str(riskAmount({ side: "SHORT", quantity: 2, entryPrice: "5000", stopPrice: "5010", multiplier: 50 }))).toBe("1000");
  });

  it("computes the R-multiple from net P&L", () => {
    expect(str(rMultiple({ side: "LONG", quantity: 100, entryPrice: "10", exitPrice: "11", stopPrice: "9.5" }))).toBe("2");
    expect(str(rMultiple({ side: "LONG", quantity: 100, entryPrice: "10", exitPrice: "11", stopPrice: "9.5", fees: "25" }))).toBe("1.5");
    expect(str(rMultiple({ side: "SHORT", quantity: 100, entryPrice: "10", exitPrice: "10.25", stopPrice: "10.5" }))).toBe("-0.5");
  });

  it("returns null without a stop, while open, or when the stop equals the entry", () => {
    expect(rMultiple({ side: "LONG", quantity: 100, entryPrice: "10", exitPrice: "11" })).toBeNull();
    expect(rMultiple({ side: "LONG", quantity: 100, entryPrice: "10", stopPrice: "9" })).toBeNull();
    expect(rMultiple({ side: "LONG", quantity: 100, entryPrice: "10", exitPrice: "11", stopPrice: "10" })).toBeNull();
  });

  it("computes the planned reward-to-risk ratio", () => {
    expect(str(plannedRewardRisk({ side: "LONG", quantity: 1, entryPrice: "10", stopPrice: "9", targetPrice: "13" }))).toBe("3");
    expect(plannedRewardRisk({ side: "LONG", quantity: 1, entryPrice: "10", stopPrice: "9" })).toBeNull();
    expect(plannedRewardRisk({ side: "LONG", quantity: 1, entryPrice: "10", stopPrice: "10", targetPrice: "12" })).toBeNull();
  });
});

describe("exitPriceForNetPnl", () => {
  it("round-trips a long trade with fees and multiplier", () => {
    const base = { side: "LONG" as const, quantity: 2, entryPrice: "5000", multiplier: 50, fees: "4.2" };
    const exit = exitPriceForNetPnl(base, "395.8");
    expect(str(exit)).toBe("5004");
    expect(str(netPnl({ ...base, exitPrice: exit }))).toBe("395.8");
  });

  it("round-trips a short trade", () => {
    const base = { side: "SHORT" as const, quantity: 100, entryPrice: "10", fees: "1" };
    const exit = exitPriceForNetPnl(base, "-51");
    expect(str(exit)).toBe("10.5");
    expect(str(netPnl({ ...base, exitPrice: exit }))).toBe("-51");
  });

  it("returns null when quantity is zero", () => {
    expect(exitPriceForNetPnl({ side: "LONG", quantity: 0, entryPrice: "10" }, "5")).toBeNull();
  });
});
