import { readFileSync } from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { hasExecutionPhrases, importErrorHint } from "@/lib/csv";
import { guessExecutionMapping, matchFills, parseFillRow, type Fill } from "@/lib/fills";
import { isSchwabTransactionHistory } from "@/lib/schwab";
import { isSchwabOrderStatus } from "@/lib/schwab-orders";
import { isThinkorswimStatement } from "@/lib/thinkorswim";

/**
 * A generic order history: separate Date and Time columns, "Buy to Open"
 * phrases, contracts in the symbol, "5 of 5" quantities, an order price that
 * carries the order type, a fill price and a status. No broker module claims
 * it; the phrases in the Action column open it in the executions mode.
 */
const text = readFileSync(path.resolve(__dirname, "../../../e2e/fixtures/order-history.csv"), "utf8");
const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
const headers = (parsed.meta.fields ?? []).filter((h) => h !== "");
const rows = parsed.data;

describe("order history export", () => {
  it("is read as executions by its phrases, not by a broker module", () => {
    expect(isThinkorswimStatement(text)).toBe(false);
    expect(isSchwabTransactionHistory(text)).toBe(false);
    expect(isSchwabOrderStatus(text)).toBe(false);
    expect(rows).toHaveLength(14);
    const mapping = guessExecutionMapping(headers);
    expect(mapping).toEqual({ symbol: "Symbol", side: "Action", quantity: "Quantity", price: "Filled Price", orderPrice: "Price", time: "Date", timeOfDay: "Time", status: "Status", fees: "Fees" });
    expect(hasExecutionPhrases(rows, mapping.side!)).toBe(true);
  });

  it("keeps the filled orders, skips the rest and matches round trips with the fill prices", () => {
    const mapping = guessExecutionMapping(headers);
    const fills: Fill[] = [];
    const unfilled: [number, string][] = [];
    const errors: { row: number; message: string }[] = [];
    rows.forEach((row, i) => {
      const result = parseFillRow(row, mapping, { timeZone: "UTC" }, i + 2);
      if (result.ok) fills.push(result.fill);
      else if (result.skipped) unfilled.push([i + 2, `${result.kind}: ${result.reason}`]);
      else errors.push({ row: i + 2, message: result.error });
    });
    expect(errors).toEqual([]);
    expect(unfilled).toEqual([
      [2, "unfilled: Expired"],
      [6, "unfilled: Cancelled"],
      [8, "unfilled: Working"],
      [9, "unfilled: Cancelled"],
      [14, "unfilled: Rejected"],
    ]);
    expect(fills).toHaveLength(9);
    expect(fills.every((f) => f.priceSource === "fill")).toBe(true);
    // "20 of 50" partially filled: the 20 count; the ET clock is read in New York whatever the import zone.
    expect(fills[0]).toMatchObject({ row: 3, symbol: "NVDA", side: "SELL", quantity: "20", price: "176", fees: "0.02" });
    expect(fills[0].time.toISOString()).toBe("2026-09-18T19:55:00.000Z");
    expect(fills.find((f) => f.row === 11)).toMatchObject({ symbol: "NVDA", side: "BUY", quantity: "50", price: "174.8" }); // fill price, not the "Limit $175.00 / Stop $170.00" order

    const result = matchFills(fills);
    expect(result.order).toBe("newest-first");
    expect(result.warnings).toEqual([]);
    expect(result.unmatched).toEqual([]);
    expect(result.trades.map((t) => [t.label.replace(/ '\d\d$/, ""), t.kind, t.side, t.quantity, t.entryPrice, t.exitPrice, t.fees, t.pnl])).toEqual([
      ["QQQ 480C Oct 16", "closed", "LONG", "2", "2.2", "2.95", "2.64", "147.36"],
      ["AAPL", "closed", "LONG", "100", "226.4", "232.1", "0.05", "569.95"],
      ["NVDA", "closed", "LONG", "20", "174.8", "176", "0.02", "23.98"],
      ["NVDA", "open", "LONG", "30", "174.8", null, "0", null],
      ["TSLA 357.5P Sep 25", "closed", "LONG", "5", "3.2", "6.4", "6.6", "1593.4"],
      ["SPY 630P Oct 2", "open", "LONG", "1", "3.15", null, "0.66", null],
    ]);
    expect(result.trades[1].entryAt.toISOString()).toBe("2026-09-17T13:31:05.000Z");
    expect(result.trades[1].exitAt?.toISOString()).toBe("2026-09-18T14:02:30.000Z");
    expect(new Set(result.trades.map((t) => t.importHashKey)).size).toBe(6);
  });

  it("explains a Market-only price column when the fill price is not mapped", () => {
    const mapping = { ...guessExecutionMapping(headers), price: "Price" };
    delete mapping.orderPrice;
    const errors: { message: string }[] = [];
    let considered = 0;
    rows.forEach((row, i) => {
      const result = parseFillRow({ ...row, Price: "Market" }, mapping, {}, i + 2);
      if (!result.ok && result.skipped) return;
      considered++;
      if (!result.ok) errors.push({ message: result.error });
    });
    expect(considered).toBe(9);
    expect(errors).toHaveLength(9);
    expect(errors[0].message).toBe('no price in column "Price": "Market" is an order type without an amount, so the row has no price; map a fill-price column (Filled Price, Avg Price, Execution Price) instead');
    const hint = importErrorHint(errors, considered);
    expect(hint).toContain("Every row fails on the price");
    expect(hint).toContain("map the fill-price column");
  });
});
