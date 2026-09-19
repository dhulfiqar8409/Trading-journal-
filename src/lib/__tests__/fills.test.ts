import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { guessExecutionMapping, matchFills, parseFillRow, parseFillSide, parsePositionEffect, type ExecutionMapping, type Fill } from "@/lib/fills";
import { thinkorswimTradeHistory } from "@/lib/thinkorswim";

let rowCounter = 0;

function fill(overrides: Omit<Partial<Fill>, "time"> & { time: string }): Fill {
  rowCounter++;
  return {
    row: rowCounter,
    symbol: "AAPL",
    assetClass: "STOCK",
    side: "BUY",
    quantity: "100",
    posEffect: null,
    price: "10",
    fees: "0",
    multiplier: "1",
    optionType: null,
    strikePrice: null,
    expiresAt: null,
    spread: null,
    ...overrides,
    time: new Date(overrides.time),
  };
}

const call = { symbol: "SPY", assetClass: "OPTION" as const, optionType: "CALL" as const, strikePrice: "450", expiresAt: new Date("2026-09-20T12:00:00Z"), multiplier: "100" };

describe("matchFills", () => {
  it("pairs a long round trip", () => {
    const result = matchFills([
      fill({ time: "2026-09-17T13:31:05Z", side: "BUY", posEffect: "OPEN", price: "150", fees: "1" }),
      fill({ time: "2026-09-17T14:05:12Z", side: "SELL", posEffect: "CLOSE", price: "152.5", fees: "1" }),
    ]);
    expect(result.unmatched).toEqual([]);
    expect(result.trades).toHaveLength(1);
    const t = result.trades[0];
    expect(t).toMatchObject({ kind: "closed", side: "LONG", status: "CLOSED", quantity: "100", entryPrice: "150", exitPrice: "152.5", fees: "2", pnl: "248", label: "AAPL" });
    expect(t.entryAt.toISOString()).toBe("2026-09-17T13:31:05.000Z");
    expect(t.exitAt?.toISOString()).toBe("2026-09-17T14:05:12.000Z");
    expect(t.fillRows).toEqual([1, 2]);
    expect(t.notes).toContain("Imported from 2 fills (rows 1, 2).");
    expect(t.importHashKey).toBe("AAPL|LONG|100|150|2026-09-17T13:31:05.000Z|exit:2026-09-17T14:05:12.000Z");
  });

  it("pairs a short round trip: sell to open, buy to close", () => {
    const result = matchFills([
      fill({ time: "2026-09-17T13:31:05Z", side: "SELL", posEffect: "OPEN", price: "20" }),
      fill({ time: "2026-09-17T15:00:00Z", side: "BUY", posEffect: "CLOSE", price: "18.5" }),
    ]);
    expect(result.trades[0]).toMatchObject({ side: "SHORT", entryPrice: "20", exitPrice: "18.5", pnl: "150", status: "CLOSED" });
  });

  it("merges the fills of one exit into a weighted average and keeps later closes as partial closes", () => {
    const result = matchFills([
      fill({ time: "2026-09-16T15:00:00Z", side: "BUY", posEffect: "OPEN", quantity: "200", price: "240", symbol: "TSLA" }),
      fill({ time: "2026-09-16T17:30:00Z", side: "SELL", posEffect: "CLOSE", quantity: "60", price: "244", symbol: "TSLA" }),
      fill({ time: "2026-09-16T17:30:02Z", side: "SELL", posEffect: "CLOSE", quantity: "40", price: "244.5", symbol: "TSLA" }),
      fill({ time: "2026-09-16T19:00:00Z", side: "SELL", posEffect: "CLOSE", quantity: "100", price: "246", symbol: "TSLA" }),
    ]);
    expect(result.trades.map((t) => [t.kind, t.quantity, t.exitPrice, t.pnl, t.exitAt?.toISOString()])).toEqual([
      ["closed", "100", "244.2", "420", "2026-09-16T17:30:02.000Z"],
      ["closed", "100", "246", "600", "2026-09-16T19:00:00.000Z"],
    ]);
    expect(result.trades[0].entryAt.toISOString()).toBe("2026-09-16T15:00:00.000Z");
    expect(result.trades[1].entryAt.toISOString()).toBe("2026-09-16T15:00:00.000Z");
  });

  it("leaves the remainder of a partial close open", () => {
    const result = matchFills([
      fill({ time: "2026-09-16T15:00:00Z", side: "BUY", posEffect: "OPEN", quantity: "200", price: "240", fees: "2" }),
      fill({ time: "2026-09-16T17:30:00Z", side: "SELL", posEffect: "CLOSE", quantity: "100", price: "244", fees: "3" }),
    ]);
    expect(result.trades.map((t) => [t.kind, t.status, t.quantity, t.entryPrice, t.exitPrice, t.fees, t.pnl])).toEqual([
      ["closed", "CLOSED", "100", "240", "244", "4", "396"], // half of the entry fees plus the closing fees
      ["open", "OPEN", "100", "240", null, "1", null],
    ]);
  });

  it("averages several opens by quantity and dates the trade from the first", () => {
    const result = matchFills([
      fill({ time: "2026-09-17T13:30:00Z", side: "BUY", posEffect: "OPEN", quantity: "100", price: "10", fees: "1" }),
      fill({ time: "2026-09-17T14:30:00Z", side: "BUY", posEffect: "OPEN", quantity: "300", price: "12", fees: "1" }),
      fill({ time: "2026-09-17T16:00:00Z", side: "SELL", posEffect: "CLOSE", quantity: "400", price: "13", fees: "2" }),
    ]);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({ quantity: "400", entryPrice: "11.5", exitPrice: "13", fees: "4", pnl: "596" });
    expect(result.trades[0].entryAt.toISOString()).toBe("2026-09-17T13:30:00.000Z");
    expect(result.trades[0].fillRows).toHaveLength(3);
  });

  it("scales options by the contract multiplier and labels them", () => {
    const result = matchFills([
      fill({ ...call, time: "2026-09-17T13:45:00Z", side: "BUY", posEffect: "OPEN", quantity: "2", price: "1.50", fees: "1.30" }),
      fill({ ...call, time: "2026-09-17T18:20:30Z", side: "SELL", posEffect: "CLOSE", quantity: "2", price: "2.10", fees: "1.30" }),
    ]);
    const t = result.trades[0];
    expect(t).toMatchObject({ assetClass: "OPTION", optionType: "CALL", strikePrice: "450", multiplier: "100", pnl: "117.4" });
    expect(t.label).toMatch(/^SPY 450C Sep 20/);
    expect(t.importHashKey).toBe("SPY|LONG|2|1.5|2026-09-17T13:45:00.000Z|CALL|450|2026-09-20|exit:2026-09-17T18:20:30.000Z");
  });

  it("reports a close without an open as unmatched, with an opt-in trade whose entry is unknown", () => {
    const result = matchFills([fill({ time: "2026-09-17T19:10:00Z", symbol: "NVDA", side: "SELL", posEffect: "CLOSE", quantity: "50", price: "131", fees: "1" })]);
    expect(result.trades).toEqual([]);
    expect(result.unmatched).toHaveLength(1);
    const u = result.unmatched[0];
    expect(u.reason).toContain("opened before the statement window");
    expect(u.reason).toContain("wider date range");
    expect(u.trade).toMatchObject({ kind: "unmatched", side: "LONG", status: "CLOSED", quantity: "50", entryPrice: "131", exitPrice: "131", fees: "1", pnl: "-1" });
    expect(u.trade.notes).toContain("Entry unknown");
    expect(u.trade.entryAt.toISOString()).toBe("2026-09-17T19:10:00.000Z");
  });

  it("infers the position effect from the running position when the file has none", () => {
    const result = matchFills([
      fill({ time: "2026-09-17T13:30:00Z", side: "BUY", price: "10" }), // flat: opens long
      fill({ time: "2026-09-17T14:00:00Z", side: "SELL", price: "11" }), // long: closes
      fill({ time: "2026-09-17T15:00:00Z", side: "SELL", price: "11" }), // flat: opens short
      fill({ time: "2026-09-17T16:00:00Z", side: "BUY", price: "10.5" }), // short: closes
    ]);
    expect(result.trades.map((t) => [t.side, t.pnl])).toEqual([
      ["LONG", "100"],
      ["SHORT", "50"],
    ]);
    expect(result.unmatched).toEqual([]);
  });

  it("flips through flat when an inferred sell exceeds the long, and flags an explicit close that does", () => {
    const flipped = matchFills([
      fill({ time: "2026-09-17T13:30:00Z", side: "BUY", quantity: "100", price: "10" }),
      fill({ time: "2026-09-17T14:00:00Z", side: "SELL", quantity: "150", price: "11" }),
    ]);
    expect(flipped.trades.map((t) => [t.kind, t.side, t.quantity, t.entryPrice])).toEqual([
      ["closed", "LONG", "100", "10"],
      ["open", "SHORT", "50", "11"],
    ]);
    expect(flipped.warnings[0]).toMatch(/opened 50 the other way/);
    const explicit = matchFills([
      fill({ time: "2026-09-17T13:30:00Z", side: "BUY", posEffect: "OPEN", quantity: "100", price: "10" }),
      fill({ time: "2026-09-17T14:00:00Z", side: "SELL", posEffect: "CLOSE", quantity: "150", price: "11" }),
    ]);
    expect(explicit.trades.map((t) => [t.kind, t.quantity])).toEqual([["closed", "100"]]);
    expect(explicit.unmatched.map((u) => u.quantity)).toEqual(["50"]);
  });

  it("orders fills by time whatever the row order, and treats spread legs as their own trades", () => {
    const result = matchFills([
      fill({ time: "2026-09-17T14:05:12Z", side: "SELL", posEffect: "CLOSE", price: "152.5" }),
      fill({ time: "2026-09-17T13:31:05Z", side: "BUY", posEffect: "OPEN", price: "150" }),
      fill({ ...call, symbol: "QQQ", optionType: "PUT", strikePrice: "470", time: "2026-09-17T15:00:00Z", side: "SELL", posEffect: "OPEN", quantity: "1", price: "5", spread: "VERTICAL" }),
      fill({ ...call, symbol: "QQQ", optionType: "PUT", strikePrice: "465", time: "2026-09-17T15:00:00Z", side: "BUY", posEffect: "OPEN", quantity: "1", price: "2.65", spread: "VERTICAL" }),
    ]);
    expect(result.trades.map((t) => [t.kind, t.side, t.symbol, t.strikePrice])).toEqual([
      ["closed", "LONG", "AAPL", null],
      ["open", "SHORT", "QQQ", "470"],
      ["open", "LONG", "QQQ", "465"],
    ]);
    expect(result.trades[0].pnl).toBe("250");
    expect(result.trades[1].notes).toContain("Leg of a VERTICAL spread");
  });

  it("produces the same hash keys for the same statement, so a re-import adds nothing", () => {
    const fills = [
      fill({ time: "2026-09-17T13:31:05Z", side: "BUY", posEffect: "OPEN", price: "150" }),
      fill({ time: "2026-09-17T14:05:12Z", side: "SELL", posEffect: "CLOSE", price: "152.5" }),
    ];
    expect(matchFills(fills).trades.map((t) => t.importHashKey)).toEqual(matchFills([...fills].reverse()).trades.map((t) => t.importHashKey));
  });

  it("tells the parts of a split position apart in the hash key", () => {
    const result = matchFills([
      fill({ time: "2026-09-16T15:00:00Z", side: "BUY", posEffect: "OPEN", quantity: "200", price: "240" }),
      fill({ time: "2026-09-16T17:30:00Z", side: "SELL", posEffect: "CLOSE", quantity: "100", price: "244" }),
    ]);
    const keys = result.trades.map((t) => t.importHashKey);
    expect(new Set(keys).size).toBe(2);
    expect(keys[0]).toBe("AAPL|LONG|100|240|2026-09-16T15:00:00.000Z|exit:2026-09-16T17:30:00.000Z");
    expect(keys[1]).toBe("AAPL|LONG|100|240|2026-09-16T15:00:00.000Z");
  });
});

describe("parseFillRow", () => {
  const mapping: ExecutionMapping = { symbol: "Symbol", side: "Side", quantity: "Qty", posEffect: "Pos Effect", price: "Price", time: "Exec Time", expiresAt: "Exp", strikePrice: "Strike", optionType: "Type", spread: "Spread", fees: "Fees" };
  const base = { Symbol: "AAPL", Side: "BUY", Qty: "+100", "Pos Effect": "TO OPEN", Price: "150.00", "Exec Time": "9/17/26 09:31:05", Exp: "", Strike: "", Type: "STOCK", Spread: "STOCK", Fees: "" };

  it("reads the thinkorswim column set, with the account's zone for the fill time", () => {
    const result = parseFillRow(base, mapping, { timeZone: "America/New_York" }, 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fill).toMatchObject({ row: 2, symbol: "AAPL", assetClass: "STOCK", side: "BUY", quantity: "100", posEffect: "OPEN", price: "150", fees: "0", multiplier: "1", optionType: null, spread: null });
    expect(result.fill.time.toISOString()).toBe("2026-09-17T13:31:05.000Z");
    const option = parseFillRow({ ...base, Symbol: "SPY", Side: "SELL", Qty: "-2", "Pos Effect": "TO CLOSE", Exp: "20 SEP 26", Strike: "450", Type: "CALL", Spread: "VERTICAL" }, mapping, {}, 3);
    expect(option.ok && option.fill).toMatchObject({ assetClass: "OPTION", side: "SELL", quantity: "2", posEffect: "CLOSE", optionType: "CALL", strikePrice: "450", multiplier: "100", spread: "VERTICAL" });
    expect(option.ok && option.fill.expiresAt?.toISOString()).toBe("2026-09-20T12:00:00.000Z");
  });

  it("takes the side from a signed quantity, the effect from BTO/STC cells, and contracts from the symbol", () => {
    const { side: _side, ...noSide } = mapping;
    void _side;
    const short = parseFillRow({ ...base, Qty: "-100", "Pos Effect": "" }, noSide);
    expect(short.ok && [short.fill.side, short.fill.posEffect]).toEqual(["SELL", null]);
    expect(parseFillRow({ ...base, Qty: "100", "Pos Effect": "" }, noSide)).toEqual({ ok: false, error: "missing side" });
    const stc = parseFillRow({ ...base, Side: "STC", "Pos Effect": "" }, mapping);
    expect(stc.ok && [stc.fill.side, stc.fill.posEffect]).toEqual(["SELL", "CLOSE"]);
    const occ = parseFillRow({ ...base, Symbol: "SPY240920C00450000", Type: "" }, mapping);
    expect(occ.ok && occ.fill).toMatchObject({ symbol: "SPY", assetClass: "OPTION", optionType: "CALL", strikePrice: "450", multiplier: "100" });
    const future = parseFillRow({ ...base, Symbol: "/ESZ6", Type: "FUTURE" }, mapping, { defaultMultiplier: "50" });
    expect(future.ok && future.fill).toMatchObject({ symbol: "ESZ6", assetClass: "FUTURES", multiplier: "50" });
  });

  it("reports row errors", () => {
    expect(parseFillRow({ ...base, Symbol: "" }, mapping)).toEqual({ ok: false, error: "missing symbol" });
    expect(parseFillRow({ ...base, Qty: "0" }, mapping)).toEqual({ ok: false, error: "quantity must not be zero" });
    expect(parseFillRow({ ...base, Side: "hold" }, mapping)).toEqual({ ok: false, error: 'unrecognised side "hold"' });
    expect(parseFillRow({ ...base, "Pos Effect": "AUTO" }, mapping)).toEqual({ ok: false, error: 'unrecognised position effect "AUTO"' });
    expect(parseFillRow({ ...base, Price: "" }, mapping)).toEqual({ ok: false, error: "missing price" });
    expect(parseFillRow({ ...base, "Exec Time": "sometime" }, mapping)).toEqual({ ok: false, error: 'invalid time "sometime"' });
    expect(parseFillRow({ ...base, Exp: "never", Type: "CALL", Strike: "450" }, mapping)).toEqual({ ok: false, error: 'invalid expiration "never"' });
  });

  it("parses side and position-effect cells", () => {
    expect(parseFillSide("Bought")).toEqual({ side: "BUY", effect: null });
    expect(parseFillSide("Buy to Open")).toEqual({ side: "BUY", effect: "OPEN" });
    expect(parseFillSide("SLD")).toEqual({ side: "SELL", effect: null });
    expect(parseFillSide("sell short")).toEqual({ side: "SELL", effect: "OPEN" });
    expect(parseFillSide("x")).toBeNull();
    expect(parsePositionEffect("TO OPEN")).toBe("OPEN");
    expect(parsePositionEffect("Closing")).toBe("CLOSE");
    expect(parsePositionEffect("")).toBeNull();
    expect(parsePositionEffect("maybe")).toBeUndefined();
  });
});

describe("thinkorswim statement", () => {
  const text = readFileSync(path.resolve(__dirname, "../../../e2e/fixtures/thinkorswim-statement.csv"), "utf8");

  it("maps the exact column set, leading empty column included", () => {
    const section = thinkorswimTradeHistory(text);
    expect(section).not.toBeNull();
    if (!section) return;
    expect(section.headers).toEqual(["Exec Time", "Spread", "Side", "Qty", "Pos Effect", "Symbol", "Exp", "Strike", "Type", "Price", "Net Price", "Order Type"]);
    expect(guessExecutionMapping(section.headers)).toEqual({
      symbol: "Symbol",
      side: "Side",
      quantity: "Qty",
      posEffect: "Pos Effect",
      price: "Price",
      time: "Exec Time",
      expiresAt: "Exp",
      strikePrice: "Strike",
      optionType: "Type",
      spread: "Spread",
    });
    expect(section.rows).toHaveLength(11);
    // The second leg of the vertical carries the first leg's time and spread.
    expect(section.rows[3]).toMatchObject({ "Exec Time": "9/17/26 11:00:00", Spread: "VERTICAL", Side: "BUY", Qty: "+1", Strike: "465" });
  });

  it("turns the fills into round trips with one unmatched close", () => {
    const section = thinkorswimTradeHistory(text)!;
    const mapping = guessExecutionMapping(section.headers);
    const fills: Fill[] = [];
    section.rows.forEach((row, i) => {
      const parsed = parseFillRow(row, mapping, { timeZone: "America/New_York" }, i + 2);
      expect(parsed.ok, `row ${i + 2}: ${parsed.ok ? "" : parsed.error}`).toBe(true);
      if (parsed.ok) fills.push(parsed.fill);
    });
    const result = matchFills(fills);
    expect(result.warnings).toEqual([]);
    expect(result.trades.map((t) => [t.label.replace(/ '\d\d$/, ""), t.kind, t.side, t.quantity, t.entryPrice, t.exitPrice, t.pnl])).toEqual([
      ["MSFT", "open", "LONG", "30", "410", null, null],
      ["TSLA", "closed", "LONG", "100", "240", "244", "400"],
      ["TSLA", "open", "LONG", "100", "240", null, null],
      ["AAPL", "closed", "LONG", "100", "150", "152.5", "250"],
      ["SPY 450C Sep 20", "closed", "LONG", "2", "1.5", "2.1", "120"],
      ["QQQ 470P Sep 20", "open", "SHORT", "1", "5", null, null],
      ["QQQ 465P Sep 20", "open", "LONG", "1", "2.65", null, null],
    ]);
    expect(result.trades[3].exitAt?.toISOString()).toBe("2026-09-17T14:05:14.000Z"); // last fill of the exit, New York time
    expect(result.trades[5].notes).toContain("VERTICAL");
    expect(result.unmatched.map((u) => [u.label, u.quantity, u.row])).toEqual([["NVDA", "50", 2]]);
  });
});
