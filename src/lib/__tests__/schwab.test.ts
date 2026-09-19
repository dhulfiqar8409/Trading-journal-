import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { guessExecutionMapping, matchFills, parseFillRow, type Fill } from "@/lib/fills";
import { isSchwabHeader, isSchwabTransactionHistory, schwabTransactions } from "@/lib/schwab";
import { isThinkorswimStatement } from "@/lib/thinkorswim";

const history = readFileSync(path.resolve(__dirname, "../../../e2e/fixtures/schwab-transactions.csv"), "utf8");

describe("Schwab transaction history", () => {
  it("recognises the header set and nothing else", () => {
    expect(isSchwabHeader(["Date", "Action", "Symbol", "Description", "Quantity", "Price", "Fees & Comm", "Amount"])).toBe(true);
    expect(isSchwabHeader(["Date", "Action", "Symbol", "Quantity", "Price", "Fees and Comm"])).toBe(true);
    expect(isSchwabHeader(["Symbol", "Side", "Qty", "Entry Price", "Exit Price", "Entry Time"])).toBe(false);
    expect(isSchwabHeader(["Exec Time", "Spread", "Side", "Qty", "Pos Effect", "Symbol", "Exp", "Strike", "Type", "Price"])).toBe(false);
    expect(isSchwabTransactionHistory(history)).toBe(true);
    expect(isThinkorswimStatement(history)).toBe(false);
    expect(isSchwabTransactionHistory("Symbol,Side,Qty,Entry Price\nAAPL,Long,100,150\n")).toBe(false);
  });

  it("reads the table past a title line and leaves the total line out", () => {
    const section = schwabTransactions(history);
    expect(section?.headers).toEqual(["Date", "Action", "Symbol", "Description", "Quantity", "Price", "Fees & Comm", "Amount"]);
    expect(section?.rows).toHaveLength(22);
    expect(section?.rows[0]).toMatchObject({ Date: "09/18/2026", Action: "Sell", Symbol: "AAPL", Quantity: "20", Price: "$232.10", "Fees & Comm": "$0.02", Amount: "$4,641.98" });
    expect(section?.rows[11]).toMatchObject({ Date: "09/14/2026 as of 09/12/2026", Action: "Expired", Symbol: "NVDA 09/12/2026 215.00 P", Quantity: "2", Price: "" });
    expect(section?.rows.some((r) => r.Date === "Transactions Total")).toBe(false);
    const titled = `"Transactions  for account Individual ...123 as of 09/19/2026 08:00:00 AM ET"\n${history.replace(/\n/g, "\r\n")}`;
    expect(schwabTransactions(titled)?.rows).toHaveLength(22);
    expect(schwabTransactions("Account Trade History\n\nExec Time,Side\n1,2\n")).toBeNull();
  });

  it("guesses the execution mapping from the Schwab columns", () => {
    expect(guessExecutionMapping(schwabTransactions(history)!.headers)).toEqual({
      symbol: "Symbol",
      side: "Action",
      quantity: "Quantity",
      price: "Price",
      time: "Date",
      fees: "Fees & Comm",
    });
  });

  it("turns the history into round trips, skipping the non-trade rows and reading same-day rows bottom up", () => {
    const section = schwabTransactions(history)!;
    const mapping = guessExecutionMapping(section.headers);
    const fills: Fill[] = [];
    const skipped: string[] = [];
    section.rows.forEach((row, i) => {
      const parsed = parseFillRow(row, mapping, { timeZone: "America/New_York" }, i + 2);
      if (parsed.ok) fills.push(parsed.fill);
      else if (parsed.skipped) skipped.push(parsed.reason);
      else expect.fail(`row ${i + 2}: ${parsed.error}`);
    });
    expect(skipped).toEqual(["Bank Interest", "Journal", "Dividend", "Reinvest Shares", "MoneyLink Transfer"]);
    expect(fills).toHaveLength(17);
    const result = matchFills(fills);
    expect(result.order).toBe("newest-first");
    expect(result.warnings).toEqual([]);
    expect(result.unmatched).toEqual([]);
    expect(result.trades.map((t) => [t.label.replace(/ '\d\d$/, ""), t.kind, t.side, t.quantity, t.entryPrice, t.exitPrice, t.fees, t.pnl])).toEqual([
      ["SPY 640P Oct 2", "closed", "SHORT", "1", "5.3", "3.9", "1.32", "138.68"],
      ["SPY 630P Oct 2", "closed", "LONG", "1", "3.15", "2.2", "1.32", "-96.32"],
      ["NVDA 215P Sep 12", "closed", "LONG", "2", "1.8", "0", "1.31", "-361.31"],
      ["AAPL", "closed", "LONG", "20", "226.4", "232.1", "0.02", "113.98"],
      ["NVDA 180C Sep 18", "closed", "SHORT", "1", "2.05", "0.35", "1.32", "168.68"],
      ["QQQ 480C Oct 16", "closed", "LONG", "2", "2.2", "3.1", "2.62", "177.38"],
      ["QQQ 480C Oct 16", "open", "LONG", "2", "2.2", null, "1.31", null],
      ["AMD 150P Sep 18", "closed", "SHORT", "1", "2.6", "0", "0.66", "259.34"],
      ["TSLA 357.5P Sep 25", "closed", "LONG", "1", "4.1", "6.4", "1.32", "228.68"],
      ["AMD", "open", "LONG", "100", "150", null, "0", null],
    ]);
    const expired = result.trades[2];
    expect(expired.exitAt?.toISOString()).toBe("2026-09-14T04:00:00.000Z"); // the posting date, midnight in New York
    expect(expired.notes).toContain("Expired worthless");
    expect(expired.fillRows).toEqual([13, 21]);
    expect(result.trades[7].notes).toContain("Assigned at the 150 strike");
    expect(result.trades[8].fillRows).toEqual([6, 7]);
    expect(result.trades[8].entryAt.toISOString()).toBe("2026-09-17T04:00:00.000Z");
    expect(result.trades[3].expiresAt).toBeNull();
    expect(result.trades[0].expiresAt?.toISOString()).toBe("2026-10-02T12:00:00.000Z");
    // The same file again produces the same identities, so a re-import adds nothing.
    expect(new Set(result.trades.map((t) => t.importHashKey)).size).toBe(10);
    expect(matchFills([...fills].reverse()).trades.map((t) => t.importHashKey)).toEqual(result.trades.map((t) => t.importHashKey));
  });
});
