import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { guessExecutionMapping, matchFills, parseFillRow, type Fill } from "@/lib/fills";
import { isSchwabHeader, isSchwabTransactionHistory } from "@/lib/schwab";
import { isSchwabOrderStatus, isSchwabOrderStatusHeader, schwabOrderStatus } from "@/lib/schwab-orders";
import { isThinkorswimStatement } from "@/lib/thinkorswim";

const HEADER = "Symbol,Strategy Name,Name of Security,Status,Action,Quantity|Face Value,Price,Timing,Fill Price,Fill Price is Average,Time and Date(ET),Last Activity Date(ET),Reinvest Capital Gains,Order Number";
const orders = readFileSync(path.resolve(__dirname, "../../../e2e/fixtures/schwab-order-status.csv"), "utf8");

describe("Schwab order status export", () => {
  it("recognises the header set, byte order mark and all, and nothing else", () => {
    expect(orders.charCodeAt(0)).toBe(0xfeff);
    expect(orders).toContain("\r\n");
    expect(isSchwabOrderStatusHeader(HEADER.split(","))).toBe(true);
    expect(isSchwabOrderStatusHeader(["Symbol", "Status", "Action", "Quantity", "Fill Price", "Time and Date"])).toBe(true);
    expect(isSchwabOrderStatusHeader(["Date", "Action", "Symbol", "Description", "Quantity", "Price", "Fees & Comm", "Amount"])).toBe(false);
    expect(isSchwabOrderStatusHeader(["Date", "Time", "Action", "Symbol", "Quantity", "Price", "Filled Price", "Status", "Fees"])).toBe(false); // no Time and Date column
    expect(isSchwabOrderStatus(orders)).toBe(true);
    expect(isSchwabTransactionHistory(orders)).toBe(false);
    expect(isSchwabHeader(HEADER.split(","))).toBe(false);
    expect(isThinkorswimStatement(orders)).toBe(false);
    expect(isSchwabOrderStatus("Symbol,Side,Qty,Entry Price\nAAPL,Long,100,150\n")).toBe(false);
  });

  it("reads the rows and makes the Eastern-time cells say so", () => {
    const section = schwabOrderStatus(orders);
    expect(section?.headers).toEqual(HEADER.split(","));
    expect(section?.rows).toHaveLength(17);
    expect(section?.rows[0]).toMatchObject({
      Symbol: "TSLA 09/25/2026 357.50 P",
      Status: "Filled",
      Action: "Sell to close",
      "Quantity|Face Value": "5 Contracts",
      Price: "Limit $6.40",
      "Fill Price": "$6.40",
      "Time and Date(ET)": "3:45 PM 09/18/2026 ET",
      "Last Activity Date(ET)": "3:45 PM 09/18/2026 ET",
      "Order Number": "1000000000014",
    });
    expect(section?.rows[2]).toMatchObject({ "Quantity|Face Value": "1,000 Shares", "Time and Date(ET)": "10:31 AM 09/18/2026 ET", "Last Activity Date(ET)": "10:36 AM 09/18/2026 ET" });
    expect(section?.rows[13]).toMatchObject({ Status: "Canceled", "Fill Price": "-" });
    const titled = `﻿"Order Status for account Individual ...322 as of 09/28/2026"\n${orders.replace(/^﻿/, "")}`;
    expect(schwabOrderStatus(titled)?.rows).toHaveLength(17);
    expect(schwabOrderStatus("Account Trade History\n\nExec Time,Side\n1,2\n")).toBeNull();
  });

  it("guesses the execution mapping: fill price, last activity as the fill time, status and order number", () => {
    expect(guessExecutionMapping(HEADER.split(","))).toEqual({
      symbol: "Symbol",
      side: "Action",
      quantity: "Quantity|Face Value",
      price: "Fill Price",
      orderPrice: "Price",
      time: "Last Activity Date(ET)",
      status: "Status",
      orderId: "Order Number",
      spread: "Strategy Name",
    });
  });

  it("turns the filled orders into round trips, skips the canceled ones and flags the partial fill", () => {
    const section = schwabOrderStatus(orders)!;
    const mapping = guessExecutionMapping(section.headers);
    const fills: Fill[] = [];
    const skipped: [number, string, string][] = [];
    section.rows.forEach((row, i) => {
      const parsed = parseFillRow(row, mapping, { timeZone: "Asia/Tokyo" }, i + 2); // the zone of the account does not matter: the cells say ET
      if (parsed.ok) fills.push(parsed.fill);
      else if (parsed.skipped) skipped.push([i + 2, parsed.kind, parsed.reason]);
      else expect.fail(`row ${i + 2}: ${parsed.error}`);
    });
    expect(skipped).toEqual([
      [14, "partial", "Closed partial fill: partial fill, filled quantity unknown; check the transaction history"],
      [15, "unfilled", "Canceled"],
      [16, "unfilled", "Canceled"],
      [17, "unfilled", "Canceled"],
      [18, "unfilled", "Canceled"],
    ]);
    expect(fills).toHaveLength(12);
    expect(fills.every((f) => f.priceSource === "fill" && f.fees === "0" && f.orderId !== null)).toBe(true);
    // Mixed-case phrases: "Sell short" opens short, "Buy to cover" closes it, plain Buy and Sell are settled against the position.
    expect(fills.map((f) => [f.side, f.posEffect])).toEqual([
      ["SELL", "CLOSE"],
      ["BUY", "OPEN"],
      ["SELL", null],
      ["BUY", null],
      ["BUY", "CLOSE"],
      ["SELL", "OPEN"],
      ["SELL", "CLOSE"],
      ["BUY", "CLOSE"],
      ["BUY", "OPEN"],
      ["SELL", "OPEN"],
      ["BUY", "OPEN"],
      ["BUY", "OPEN"],
    ]);
    expect(fills[2]).toMatchObject({ symbol: "AAPL", quantity: "1000", price: "232.1", assetClass: "STOCK", multiplier: "1" });
    expect(fills[2].time.toISOString()).toBe("2026-09-18T14:36:00.000Z"); // the last activity, EDT: the fill, not the 10:31 placement
    expect(fills[7]).toMatchObject({ symbol: "QQQ", quantity: "1", optionType: "PUT", strikePrice: "480", multiplier: "100" }); // "1 Contract"
    expect(fills[6]).toMatchObject({ symbol: "NVDA", quantity: "10", price: "2.9512" });

    const result = matchFills(fills);
    expect(result.order).toBe("newest-first");
    expect(result.warnings).toEqual([]);
    expect(result.unmatched).toEqual([]);
    expect(result.trades.map((t) => [t.label.replace(/ '\d\d$/, ""), t.kind, t.side, t.quantity, t.entryPrice, t.exitPrice, t.pnl])).toEqual([
      ["SPY 640C Oct 2", "open", "LONG", "4", "3", null, null],
      ["QQQ 480P Oct 16", "closed", "SHORT", "1", "5.3", "3.9", "140"],
      ["NVDA 230C Oct 5", "closed", "LONG", "10", "2.2", "2.9512", "751.2"],
      ["AMD", "closed", "SHORT", "100", "150", "148.5", "150"],
      ["AAPL", "closed", "LONG", "1000", "226.4", "232.1", "5700"],
      ["TSLA 357.5P Sep 25", "closed", "LONG", "5", "3.2", "6.4", "1600"],
    ]);
    // The same-minute open and close, listed newest first, were read from the bottom up.
    expect(result.trades[5].fillRows).toEqual([2, 3]);
    expect(result.trades[5].entryAt.toISOString()).toBe("2026-09-18T19:45:00.000Z");
    // Order numbers are part of every identity, and the same file gives the same identities however it is ordered.
    expect(result.trades[4].importHashKey).toBe("AAPL|LONG|1000|226.4|2026-09-18T14:02:00.000Z|exit:2026-09-18T14:36:00.000Z|orders:1000000000011,1000000000012");
    expect(result.trades[0].importHashKey).toBe("SPY|LONG|4|3|2026-09-16T13:45:00.000Z|CALL|640|2026-10-02|orders:1000000000003,1000000000004");
    expect(new Set(result.trades.map((t) => t.importHashKey)).size).toBe(6);
    expect(matchFills([...fills].reverse()).trades.map((t) => t.importHashKey)).toEqual(result.trades.map((t) => t.importHashKey));
  });
});
