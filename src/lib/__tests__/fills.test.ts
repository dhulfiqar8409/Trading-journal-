import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fillOrder, guessExecutionMapping, matchFills, parseFillEvent, parseFillRow, parsePositionEffect, type ExecutionMapping, type Fill } from "@/lib/fills";
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
    timeOfDay: true,
    event: null,
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
    expect(result.fill).toMatchObject({ row: 2, symbol: "AAPL", assetClass: "STOCK", side: "BUY", quantity: "100", posEffect: "OPEN", price: "150", fees: "0", multiplier: "1", optionType: null, spread: null, timeOfDay: true, event: null });
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

  it("parses position-effect and event cells", () => {
    expect(parsePositionEffect("TO OPEN")).toBe("OPEN");
    expect(parsePositionEffect("Closing")).toBe("CLOSE");
    expect(parsePositionEffect("")).toBeNull();
    expect(parsePositionEffect("maybe")).toBeUndefined();
    expect(parseFillEvent("Expired")).toBe("EXPIRED");
    expect(parseFillEvent("ASSIGNED")).toBe("ASSIGNED");
    expect(parseFillEvent("Exchange or Exercise")).toBe("EXERCISED");
    expect(parseFillEvent("Sell to Close")).toBeNull();
  });

  it("reads the Schwab column set: phrases as side and effect, contracts in the symbol, money with dollar signs, dates without times", () => {
    const schwab: ExecutionMapping = { symbol: "Symbol", side: "Action", quantity: "Quantity", price: "Price", time: "Date", fees: "Fees & Comm" };
    const row = { Date: "09/17/2026", Action: "Sell to Close", Symbol: "TSLA 09/25/2026 357.50 P", Description: "PUT TESLA INC $357.5 EXP 09/25/26", Quantity: "1", Price: "$6.40", "Fees & Comm": "$0.66", Amount: "$639.34" };
    const stc = parseFillRow(row, schwab, { timeZone: "America/New_York" }, 6);
    expect(stc.ok && stc.fill).toMatchObject({ row: 6, symbol: "TSLA", assetClass: "OPTION", optionType: "PUT", strikePrice: "357.5", side: "SELL", posEffect: "CLOSE", quantity: "1", price: "6.4", fees: "0.66", multiplier: "100", timeOfDay: false, event: null });
    expect(stc.ok && stc.fill.expiresAt?.toISOString()).toBe("2026-09-25T12:00:00.000Z");
    expect(stc.ok && stc.fill.time.toISOString()).toBe("2026-09-17T04:00:00.000Z"); // midnight in New York
    const bto = parseFillRow({ ...row, Action: "Buy to Open", Price: "$4.10", Amount: "-$410.66" }, schwab);
    expect(bto.ok && [bto.fill.side, bto.fill.posEffect, bto.fill.price]).toEqual(["BUY", "OPEN", "4.1"]);
    const btc = parseFillRow({ ...row, Action: "Buy to Close", Symbol: "NVDA 09/28/2026 215.00 P", Quantity: "2", Price: "$1,050.25" }, schwab);
    expect(btc.ok && btc.fill).toMatchObject({ symbol: "NVDA", side: "BUY", posEffect: "CLOSE", quantity: "2", price: "1050.25", strikePrice: "215" });
    const stock = parseFillRow({ ...row, Action: "Sell", Symbol: "AAPL", Quantity: "20", Price: "$232.10", "Fees & Comm": "$0.02" }, schwab);
    expect(stock.ok && stock.fill).toMatchObject({ symbol: "AAPL", assetClass: "STOCK", side: "SELL", posEffect: null, price: "232.1", fees: "0.02", multiplier: "1" });
  });

  it("turns Expired, Assigned and Exchange or Exercise rows into closes at 0, with the first of an 'as of' date pair", () => {
    const schwab: ExecutionMapping = { symbol: "Symbol", side: "Action", quantity: "Quantity", price: "Price", time: "Date", fees: "Fees & Comm" };
    const expired = parseFillRow({ Date: "09/14/2026 as of 09/12/2026", Action: "Expired", Symbol: "NVDA 09/12/2026 215.00 P", Quantity: "2", Price: "", "Fees & Comm": "" }, schwab, {}, 13);
    expect(expired.ok && expired.fill).toMatchObject({ event: "EXPIRED", posEffect: "CLOSE", price: "0", fees: "0", quantity: "2", optionType: "PUT", strikePrice: "215" });
    expect(expired.ok && expired.fill.time.toISOString()).toBe("2026-09-14T00:00:00.000Z");
    const assigned = parseFillRow({ Date: "09/18/2026", Action: "Assigned", Symbol: "AMD 09/18/2026 150.00 P", Quantity: "1", Price: "", "Fees & Comm": "" }, schwab);
    expect(assigned.ok && assigned.fill).toMatchObject({ event: "ASSIGNED", posEffect: "CLOSE", price: "0" });
    const exercised = parseFillRow({ Date: "09/18/2026", Action: "Exchange or Exercise", Symbol: "AMD 09/18/2026 150.00 C", Quantity: "1", Price: "", "Fees & Comm": "" }, schwab);
    expect(exercised.ok && exercised.fill).toMatchObject({ event: "EXERCISED", posEffect: "CLOSE", price: "0", optionType: "CALL" });
  });

  it("skips non-trade rows rather than failing them", () => {
    const schwab: ExecutionMapping = { symbol: "Symbol", side: "Action", quantity: "Quantity", price: "Price", time: "Date", fees: "Fees & Comm" };
    for (const action of ["Bank Interest", "Journal", "MoneyLink Transfer", "Dividend", "Reinvest Shares", "Stock Split", "Margin Interest", "Wire Funds Received"]) {
      expect(parseFillRow({ Date: "09/12/2026", Action: action, Symbol: "", Quantity: "", Price: "", "Fees & Comm": "" }, schwab), action).toEqual({ ok: false, skipped: true, reason: action });
    }
    expect(parseFillRow({ Date: "09/12/2026", Action: "Hold", Symbol: "MSFT", Quantity: "1", Price: "1", "Fees & Comm": "" }, schwab)).toEqual({ ok: false, error: 'unrecognised side "Hold"' });
  });
});

describe("fillOrder", () => {
  const dated = (row: number, day: string, extra: Omit<Partial<Fill>, "time"> = {}) => fill({ row, time: `2026-09-${day}T00:00:00Z`, timeOfDay: false, ...extra });

  it("reads a dated-only file listed newest first from the bottom up, and keeps every other order", () => {
    expect(fillOrder([dated(1, "18"), dated(2, "17"), dated(3, "17"), dated(4, "15")])).toBe("newest-first");
    expect(fillOrder([dated(1, "15"), dated(2, "17"), dated(3, "17"), dated(4, "18")])).toBe("as-listed");
    expect(fillOrder([dated(1, "18"), dated(2, "15"), dated(3, "17")])).toBe("as-listed"); // mixed
    expect(fillOrder([dated(1, "17"), dated(2, "17")])).toBe("as-listed"); // one day: nothing to tell
    expect(fillOrder([fill({ row: 1, time: "2026-09-18T15:00:00Z" }), fill({ row: 2, time: "2026-09-17T15:00:00Z" })])).toBe("as-listed"); // times of day settle the order
    expect(fillOrder([dated(1, "18")])).toBe("as-listed");
  });

  it("matches a same-day open and close listed newest first", () => {
    const result = matchFills([
      dated(2, "17", { side: "SELL", posEffect: "CLOSE", price: "6.4", symbol: "TSLA" }),
      dated(3, "17", { side: "BUY", posEffect: "OPEN", price: "4.1", symbol: "TSLA" }),
      dated(4, "10", { side: "BUY", posEffect: "OPEN", price: "226.4" }),
    ]);
    expect(result.order).toBe("newest-first");
    expect(result.unmatched).toEqual([]);
    expect(result.trades.map((t) => [t.symbol, t.kind, t.entryPrice, t.exitPrice])).toEqual([
      ["AAPL", "open", "226.4", null],
      ["TSLA", "closed", "4.1", "6.4"],
    ]);
    // The same rows the other way round are read top-down and the close comes first.
    const ascending = matchFills([dated(2, "17", { side: "SELL", posEffect: "CLOSE", price: "6.4" }), dated(3, "17", { side: "BUY", posEffect: "OPEN", price: "4.1" }), dated(1, "10", { side: "BUY", posEffect: "OPEN", price: "226.4" })]);
    expect(ascending.order).toBe("as-listed");
    expect(ascending.trades.map((t) => [t.kind, t.entryPrice, t.exitPrice])).toEqual([["closed", "226.4", "6.4"], ["open", "4.1", null]]);
    // Passing the order explicitly overrides the guess.
    expect(matchFills([dated(2, "17", { side: "SELL", posEffect: "CLOSE" }), dated(3, "17", { side: "BUY", posEffect: "OPEN" })], { order: "as-listed" }).unmatched).toHaveLength(1);
  });
});

describe("contract events", () => {
  const put = { symbol: "NVDA", assetClass: "OPTION" as const, optionType: "PUT" as const, strikePrice: "215", expiresAt: new Date("2026-09-12T12:00:00Z"), multiplier: "100", timeOfDay: false };

  it("closes an expired long contract at 0", () => {
    const result = matchFills([
      fill({ ...put, row: 5, time: "2026-09-09T00:00:00Z", side: "BUY", posEffect: "OPEN", quantity: "2", price: "1.8", fees: "1.31" }),
      fill({ ...put, row: 2, time: "2026-09-14T00:00:00Z", side: "SELL", posEffect: "CLOSE", quantity: "2", price: "0", event: "EXPIRED" }),
    ]);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({ kind: "closed", side: "LONG", quantity: "2", entryPrice: "1.8", exitPrice: "0", fees: "1.31", pnl: "-361.31" });
    expect(result.trades[0].exitAt?.toISOString()).toBe("2026-09-14T00:00:00.000Z");
    expect(result.trades[0].notes).toContain("Expired worthless");
  });

  it("closes an expired or assigned short contract at 0 whatever side the event row carries, noting the strike", () => {
    const shortPut = { ...put, symbol: "AMD", strikePrice: "150", expiresAt: new Date("2026-09-18T12:00:00Z") };
    const expired = matchFills([
      fill({ ...shortPut, row: 3, time: "2026-09-14T00:00:00Z", side: "SELL", posEffect: "OPEN", price: "2.6", fees: "0.66", quantity: "1" }),
      fill({ ...shortPut, row: 1, time: "2026-09-18T00:00:00Z", side: "SELL", posEffect: "CLOSE", price: "0", quantity: "1", event: "EXPIRED" }),
    ]);
    expect(expired.trades[0]).toMatchObject({ side: "SHORT", entryPrice: "2.6", exitPrice: "0", pnl: "259.34", status: "CLOSED" });
    const assigned = matchFills([
      fill({ ...shortPut, row: 3, time: "2026-09-14T00:00:00Z", side: "SELL", posEffect: "OPEN", price: "2.6", fees: "0.66", quantity: "1" }),
      fill({ ...shortPut, row: 1, time: "2026-09-18T00:00:00Z", side: "SELL", posEffect: "CLOSE", price: "0", quantity: "1", event: "ASSIGNED" }),
      fill({ row: 2, symbol: "AMD", time: "2026-09-18T00:00:00Z", side: "BUY", quantity: "100", price: "150", timeOfDay: false }),
    ]);
    expect(assigned.unmatched).toEqual([]);
    expect(assigned.trades.map((t) => [t.label.replace(/ '\d\d$/, ""), t.kind, t.side, t.pnl])).toEqual([
      ["AMD 150P Sep 18", "closed", "SHORT", "259.34"],
      ["AMD", "open", "LONG", null],
    ]);
    expect(assigned.trades[0].notes).toContain("Assigned at the 150 strike");
    expect(assigned.trades[0].notes).toContain("closed at 0");
    const exercised = matchFills([
      fill({ ...shortPut, optionType: "CALL", row: 3, time: "2026-09-14T00:00:00Z", side: "BUY", posEffect: "OPEN", price: "3", quantity: "1" }),
      fill({ ...shortPut, optionType: "CALL", row: 1, time: "2026-09-18T00:00:00Z", side: "SELL", posEffect: "CLOSE", price: "0", quantity: "1", event: "EXERCISED" }),
    ]);
    expect(exercised.trades[0]).toMatchObject({ side: "LONG", exitPrice: "0", pnl: "-300" });
    expect(exercised.trades[0].notes).toContain("Exercised at the 150 strike");
  });

  it("reports an expiration with no open in the file as unmatched", () => {
    const result = matchFills([fill({ ...put, row: 2, time: "2026-09-14T00:00:00Z", side: "SELL", posEffect: "CLOSE", quantity: "2", price: "0", event: "EXPIRED" })]);
    expect(result.trades).toEqual([]);
    expect(result.unmatched[0].reason).toContain("before it expired");
    expect(result.unmatched[0].trade).toMatchObject({ kind: "unmatched", entryPrice: "0", exitPrice: "0", pnl: "0" });
    expect(result.unmatched[0].trade.notes).toContain("Entry unknown");
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
      expect(parsed.ok, `row ${i + 2}: ${parsed.ok ? "" : parsed.skipped ? parsed.reason : parsed.error}`).toBe(true);
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
