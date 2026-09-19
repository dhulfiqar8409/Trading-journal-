import { describe, expect, it } from "vitest";
import { guessMapping, hasExecutionPhrases, isClosingAction, isExecutionPhrase, nonTradeAction, parseAction, parseAssetClass, parseImportRow, parseNumber, parseOptionType, parseSide, type ColumnMapping } from "@/lib/csv";
import { importHash, importHashKey } from "@/lib/import-hash";

describe("guessMapping", () => {
  it("recognises common broker headers", () => {
    const headers = ["Symbol", "Side", "Qty", "Entry Price", "Exit Price", "Entry Time", "Exit Time", "Commission", "Net P&L", "Notes"];
    expect(guessMapping(headers)).toEqual({
      symbol: "Symbol",
      side: "Side",
      quantity: "Qty",
      entryPrice: "Entry Price",
      exitPrice: "Exit Price",
      entryAt: "Entry Time",
      exitAt: "Exit Time",
      fees: "Commission",
      pnl: "Net P&L",
      notes: "Notes",
    });
  });

  it("handles snake_case, ambiguous open/close and substring matches", () => {
    const m = guessMapping(["ticker", "buy_sell", "size", "open", "close", "open_date", "close_date", "fees_usd", "profit_loss"]);
    expect(m.symbol).toBe("ticker");
    expect(m.side).toBe("buy_sell");
    expect(m.quantity).toBe("size");
    expect(m.entryPrice).toBe("open");
    expect(m.exitPrice).toBe("close");
    expect(m.entryAt).toBe("open_date");
    expect(m.exitAt).toBe("close_date");
    expect(m.fees).toBe("fees_usd");
    expect(m.pnl).toBe("profit_loss");
  });

  it("never assigns one header to two fields", () => {
    const m = guessMapping(["Date", "Symbol", "Quantity", "Price"]);
    expect(m.entryAt).toBe("Date");
    expect(m.exitAt).toBeUndefined();
    const values = Object.values(m);
    expect(new Set(values).size).toBe(values.length);
  });

  it("returns an empty mapping for unknown headers", () => {
    expect(guessMapping(["foo", "bar"])).toEqual({});
  });

  it("recognises option columns", () => {
    const m = guessMapping(["Symbol", "Put/Call", "Strike", "Expiration Date", "Qty", "Price", "Date"]);
    expect(m.optionType).toBe("Put/Call");
    expect(m.strikePrice).toBe("Strike");
    expect(m.expiresAt).toBe("Expiration Date");
    expect(m.symbol).toBe("Symbol");
  });
});

describe("cell parsers", () => {
  it("parses sides", () => {
    expect(parseSide("Long")).toBe("LONG");
    expect(parseSide("BUY")).toBe("LONG");
    expect(parseSide("b")).toBe("LONG");
    expect(parseSide("short")).toBe("SHORT");
    expect(parseSide("Sell")).toBe("SHORT");
    expect(parseSide("SLD")).toBe("SHORT");
    expect(parseSide("Buy to Open")).toBe("LONG");
    expect(parseSide("Sell to Open")).toBe("SHORT");
    expect(parseSide("Sell to Close")).toBeNull(); // a closing execution is not a side of a trade
    expect(parseSide("sideways")).toBeNull();
  });

  it("parses combined side-and-effect phrases, case and punctuation aside", () => {
    expect(parseAction("Buy to Open")).toEqual({ side: "BUY", effect: "OPEN" });
    expect(parseAction("SELL TO CLOSE")).toEqual({ side: "SELL", effect: "CLOSE" });
    expect(parseAction("sell_to_open")).toEqual({ side: "SELL", effect: "OPEN" });
    expect(parseAction("Buy To Close")).toEqual({ side: "BUY", effect: "CLOSE" });
    expect(parseAction("BTO")).toEqual({ side: "BUY", effect: "OPEN" });
    expect(parseAction("stc")).toEqual({ side: "SELL", effect: "CLOSE" });
    expect(parseAction("STO")).toEqual({ side: "SELL", effect: "OPEN" });
    expect(parseAction("BTC")).toEqual({ side: "BUY", effect: "CLOSE" });
    expect(parseAction("Bought To Open")).toEqual({ side: "BUY", effect: "OPEN" });
    expect(parseAction("Sold to Close")).toEqual({ side: "SELL", effect: "CLOSE" });
    expect(parseAction("Bought")).toEqual({ side: "BUY", effect: null });
    expect(parseAction("Sold")).toEqual({ side: "SELL", effect: null });
    expect(parseAction("Buy")).toEqual({ side: "BUY", effect: null });
    expect(parseAction("sell")).toEqual({ side: "SELL", effect: null });
    expect(parseAction("Sell Short")).toEqual({ side: "SELL", effect: "OPEN" });
    expect(parseAction("Buy to Cover")).toEqual({ side: "BUY", effect: "CLOSE" });
    expect(parseAction("Dividend")).toBeNull();
    expect(parseAction("")).toBeNull();
    expect(isClosingAction("Sell to Close")).toBe(true);
    expect(isClosingAction("Buy to Open")).toBe(false);
  });

  it("tells execution phrases and non-trade actions apart", () => {
    expect(isExecutionPhrase("Sell to Close")).toBe(true);
    expect(isExecutionPhrase("bto")).toBe(true);
    expect(isExecutionPhrase("Buy")).toBe(false);
    expect(isExecutionPhrase("Sell Short")).toBe(false); // a plain short trade may be listed that way
    expect(hasExecutionPhrases([{ Action: "Buy" }, { Action: "Sell to Close" }], "Action")).toBe(true);
    expect(hasExecutionPhrases([{ Action: "Buy" }, { Action: "Sell" }], "Action")).toBe(false);
    expect(hasExecutionPhrases([{ Side: "Long" }], "Action")).toBe(false);
    for (const action of ["Journal", "Bank Interest", "MoneyLink Transfer", "Dividend", "Qualified Dividend", "Reinvest Shares", "Stock Split", "Service Fee", "Wire Funds"]) {
      expect(nonTradeAction(action), action).toBe(action);
    }
    expect(nonTradeAction("Buy to Open")).toBeNull();
    expect(nonTradeAction("Expired")).toBeNull();
    expect(nonTradeAction("")).toBeNull();
  });

  it("parses asset classes", () => {
    expect(parseAssetClass("Equity")).toBe("STOCK");
    expect(parseAssetClass("OPT")).toBe("OPTION");
    expect(parseAssetClass("Futures")).toBe("FUTURES");
    expect(parseAssetClass("FX")).toBe("FOREX");
    expect(parseAssetClass("crypto")).toBe("CRYPTO");
    expect(parseAssetClass("bond")).toBeNull();
  });

  it("parses numbers with currency symbols, thousands separators and accounting negatives", () => {
    expect(parseNumber("$1,234.50")).toBe("1234.5");
    expect(parseNumber("(12.50)")).toBe("-12.5");
    expect(parseNumber("-0.25")).toBe("-0.25");
    expect(parseNumber("+3")).toBe("3");
    expect(parseNumber("1.234,56")).toBe("1234.56");
    expect(parseNumber("12,5")).toBe("12.5");
    expect(parseNumber("100 USD")).toBe("100");
    expect(parseNumber(".5")).toBe("0.5");
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber("")).toBeNull();
  });
});

describe("parseImportRow", () => {
  const mapping: ColumnMapping = {
    symbol: "Symbol",
    side: "Side",
    quantity: "Qty",
    entryPrice: "Entry",
    exitPrice: "Exit",
    entryAt: "Opened",
    exitAt: "Closed",
    fees: "Fees",
    notes: "Notes",
  };

  const base = {
    Symbol: "aapl",
    Side: "Long",
    Qty: "100",
    Entry: "150.00",
    Exit: "152.50",
    Opened: "2024-03-12 09:31",
    Closed: "2024-03-12 10:05",
    Fees: "1.20",
    Notes: "Gap and go",
  };

  it("parses a closed long trade and computes P&L", () => {
    const result = parseImportRow(base, mapping);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.row.symbol).toBe("AAPL");
    expect(result.row.side).toBe("LONG");
    expect(result.row.status).toBe("CLOSED");
    expect(result.row.quantity).toBe("100");
    expect(result.row.entryPrice).toBe("150");
    expect(result.row.exitPrice).toBe("152.5");
    expect(result.row.pnl).toBe("248.8");
    expect(result.row.fees).toBe("1.2");
    expect(result.row.entryAt.toISOString()).toBe("2024-03-12T09:31:00.000Z");
    expect(result.row.exitAt?.toISOString()).toBe("2024-03-12T10:05:00.000Z");
    expect(result.row.notes).toBe("Gap and go");
    expect(result.row.importHashKey).toBe("AAPL|LONG|100|150|2024-03-12T09:31:00.000Z");
  });

  it("treats a missing exit as an open trade and drops any exit time", () => {
    const result = parseImportRow({ ...base, Exit: "" }, mapping);
    expect(result.ok && result.row.status).toBe("OPEN");
    expect(result.ok && result.row.pnl).toBeNull();
    expect(result.ok && result.row.exitAt).toBeNull();
  });

  it("defaults the exit time to the entry time when only an exit price is given", () => {
    const result = parseImportRow({ ...base, Closed: "" }, mapping);
    expect(result.ok && result.row.status).toBe("CLOSED");
    expect(result.ok && result.row.exitAt?.toISOString()).toBe("2024-03-12T09:31:00.000Z");
  });

  it("infers a short side from a negative quantity when no side column is mapped", () => {
    const { side: _side, ...noSide } = mapping;
    void _side;
    const result = parseImportRow({ ...base, Qty: "-50" }, noSide);
    expect(result.ok && result.row.side).toBe("SHORT");
    expect(result.ok && result.row.quantity).toBe("50");
    expect(result.ok && result.row.pnl).toBe("-126.2");
  });

  it("derives the exit price from a P&L column when the file has no exit price", () => {
    const m: ColumnMapping = { ...mapping, exitPrice: undefined, pnl: "PnL" };
    const result = parseImportRow({ ...base, Exit: "", PnL: "248.80" }, m);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.row.exitPrice).toBe("152.5");
    expect(result.row.pnl).toBe("248.8");
    expect(result.row.status).toBe("CLOSED");
  });

  it("applies the default multiplier and asset class, and computes the R-multiple from a stop", () => {
    const m: ColumnMapping = { ...mapping, stopPrice: "Stop" };
    const result = parseImportRow({ ...base, Stop: "149.00" }, m, { defaultMultiplier: "1", defaultAssetClass: "STOCK" });
    expect(result.ok && result.row.rMultiple).toBe("2.488");
    const futures = parseImportRow(
      { Symbol: "ESM4", Side: "Short", Qty: "2", Entry: "5000", Exit: "4996", Opened: "03/12/2024 09:31:00", Closed: "03/12/2024 09:45:00", Fees: "4.20", Notes: "" },
      mapping,
      { defaultMultiplier: "50", defaultAssetClass: "FUTURES" },
    );
    expect(futures.ok && futures.row.assetClass).toBe("FUTURES");
    expect(futures.ok && futures.row.multiplier).toBe("50");
    expect(futures.ok && futures.row.pnl).toBe("395.8");
  });

  it("uses the requested zone and day-first option for dates", () => {
    const result = parseImportRow({ ...base, Opened: "12/03/2024 09:31", Closed: "12/03/2024 10:05" }, mapping, {
      dayFirst: true,
      timeZone: "America/New_York",
    });
    expect(result.ok && result.row.entryAt.toISOString()).toBe("2024-03-12T13:31:00.000Z");
  });

  it("reads a contract out of the symbol and makes the row a 100-share option", () => {
    const result = parseImportRow({ ...base, Symbol: "SPY240920C00450000" }, mapping);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.row.symbol).toBe("SPY");
    expect(result.row.assetClass).toBe("OPTION");
    expect(result.row.optionType).toBe("CALL");
    expect(result.row.strikePrice).toBe("450");
    expect(result.row.expiresAt?.toISOString()).toBe("2024-09-20T12:00:00.000Z");
    expect(result.row.multiplier).toBe("100");
    expect(result.row.pnl).toBe("24998.8");
    expect(result.row.importHashKey).toBe("SPY|LONG|100|150|2024-03-12T09:31:00.000Z|CALL|450|2024-09-20");
    // A multiplier column on the row wins over the contract default.
    const own = parseImportRow({ ...base, Symbol: "SPY 09/20/2024 450 P", Mult: "10" }, { ...mapping, multiplier: "Mult" });
    expect(own.ok && own.row.multiplier).toBe("10");
    expect(own.ok && own.row.optionType).toBe("PUT");
  });

  it("takes option details from explicit columns, which win over the symbol", () => {
    const m: ColumnMapping = { ...mapping, optionType: "Right", strikePrice: "Strike", expiresAt: "Expiry" };
    const result = parseImportRow({ ...base, Symbol: "AAPL", Right: "Put", Strike: "$220.00", Expiry: "10/18/2024" }, m);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.row.assetClass).toBe("OPTION");
    expect(result.row.optionType).toBe("PUT");
    expect(result.row.strikePrice).toBe("220");
    expect(result.row.expiresAt?.toISOString()).toBe("2024-10-18T12:00:00.000Z");
    expect(result.row.multiplier).toBe("100");
    const overridden = parseImportRow({ ...base, Symbol: "SPY240920C00450000", Right: "P", Strike: "", Expiry: "" }, m);
    expect(overridden.ok && overridden.row.optionType).toBe("PUT");
    expect(overridden.ok && overridden.row.strikePrice).toBe("450");
    expect(parseImportRow({ ...base, Right: "maybe" }, m)).toEqual({ ok: false, error: 'unrecognised call/put "maybe"' });
    expect(parseImportRow({ ...base, Strike: "0" }, m)).toEqual({ ok: false, error: 'invalid strike "0"' });
    expect(parseImportRow({ ...base, Expiry: "someday" }, m)).toEqual({ ok: false, error: 'invalid expiration "someday"' });
    // Plain rows are untouched: no option fields, the default multiplier.
    const plain = parseImportRow(base, m);
    expect(plain.ok && plain.row.optionType).toBeNull();
    expect(plain.ok && plain.row.multiplier).toBe("1");
    expect(plain.ok && plain.row.importHashKey).toBe("AAPL|LONG|100|150|2024-03-12T09:31:00.000Z");
  });

  it("parses call and put cells", () => {
    expect(parseOptionType("Call")).toBe("CALL");
    expect(parseOptionType("c")).toBe("CALL");
    expect(parseOptionType("PUTS")).toBe("PUT");
    expect(parseOptionType("p.")).toBe("PUT");
    expect(parseOptionType("straddle")).toBeNull();
  });

  it("reports row errors", () => {
    expect(parseImportRow({ ...base, Symbol: "" }, mapping)).toEqual({ ok: false, error: "missing symbol" });
    expect(parseImportRow({ ...base, Qty: "lots" }, mapping)).toEqual({ ok: false, error: 'invalid quantity "lots"' });
    expect(parseImportRow({ ...base, Qty: "0" }, mapping)).toEqual({ ok: false, error: "quantity must not be zero" });
    expect(parseImportRow({ ...base, Side: "maybe" }, mapping)).toEqual({ ok: false, error: 'unrecognised side "maybe"' });
    expect(parseImportRow({ ...base, Entry: "" }, mapping)).toEqual({ ok: false, error: "missing entry price" });
    expect(parseImportRow({ ...base, Opened: "yesterday" }, mapping)).toEqual({ ok: false, error: 'invalid entry time "yesterday"' });
    expect(parseImportRow({ ...base, Closed: "2024-03-11 10:00" }, mapping)).toEqual({ ok: false, error: "exit time is before entry time" });
  });
});

describe("import hash", () => {
  const identity = { symbol: " aapl ", side: "LONG" as const, quantity: "100.00", entryPrice: "150.0", entryAt: new Date("2024-03-12T09:31:00Z") };

  it("normalises symbol case and decimal formatting", () => {
    expect(importHashKey(identity)).toBe("AAPL|LONG|100|150|2024-03-12T09:31:00.000Z");
    expect(importHash(identity)).toBe(importHash({ ...identity, symbol: "AAPL", quantity: 100, entryPrice: "150" }));
  });

  it("changes when any identity field changes", () => {
    const h = importHash(identity);
    expect(importHash({ ...identity, side: "SHORT" })).not.toBe(h);
    expect(importHash({ ...identity, quantity: "101" })).not.toBe(h);
    expect(importHash({ ...identity, entryAt: new Date("2024-03-12T09:32:00Z") })).not.toBe(h);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("closing executions in a trade file", () => {
  const mapping: ColumnMapping = { symbol: "Symbol", side: "Action", quantity: "Quantity", entryPrice: "Price", entryAt: "Date", fees: "Fees & Comm" };
  const row = { Date: "09/17/2026", Action: "Buy to Open", Symbol: "TSLA 09/25/2026 357.50 P", Quantity: "1", Price: "$4.10", "Fees & Comm": "$0.66" };

  it("reads opening phrases as the side and refuses closing ones with a pointer to the executions mode", () => {
    const open = parseImportRow(row, mapping);
    expect(open.ok && open.row).toMatchObject({ symbol: "TSLA", side: "LONG", assetClass: "OPTION", optionType: "PUT", strikePrice: "357.5", entryPrice: "4.1", status: "OPEN" });
    const short = parseImportRow({ ...row, Action: "Sell to Open" }, mapping);
    expect(short.ok && short.row.side).toBe("SHORT");
    for (const action of ["Sell to Close", "Buy to Close", "STC", "btc"]) {
      const closing = parseImportRow({ ...row, Action: action }, mapping);
      expect(closing.ok).toBe(false);
      if (closing.ok) continue;
      expect(closing.reason).toBe("closing-execution");
      expect(closing.error).toContain(`closing execution "${action}"`);
      expect(closing.error).toContain("An execution");
    }
    const odd = parseImportRow({ ...row, Action: "Hold" }, mapping);
    expect(!odd.ok && odd.reason).toBeUndefined();
    expect(!odd.ok && odd.error).toBe('unrecognised side "Hold"');
  });
});
