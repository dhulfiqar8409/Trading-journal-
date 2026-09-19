import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isThinkorswimStatement, thinkorswimTradeHistory } from "@/lib/thinkorswim";

const statement = readFileSync(path.resolve(__dirname, "../../../e2e/fixtures/thinkorswim-statement.csv"), "utf8");

describe("thinkorswim statements", () => {
  it("recognises an Account Statement and nothing else", () => {
    expect(isThinkorswimStatement(statement)).toBe(true);
    expect(isThinkorswimStatement("Symbol,Side,Qty,Entry Price\nAAPL,Long,100,150\n")).toBe(false);
    expect(isThinkorswimStatement("Account Trade History\nfoo,bar\n1,2\n")).toBe(false); // no execution columns
  });

  it("reads only the Account Trade History section", () => {
    const section = thinkorswimTradeHistory(statement);
    expect(section?.rows).toHaveLength(11);
    expect(section?.rows.every((r) => !("DATE" in r) && !("Mark Value" in r))).toBe(true);
    expect(section?.rows[0]).toMatchObject({ "Exec Time": "9/17/26 15:10:00", Spread: "STOCK", Side: "SELL", Qty: "-50", "Pos Effect": "TO CLOSE", Symbol: "NVDA", Type: "STOCK", Price: "131.00" });
    expect(section?.rows[10]).toMatchObject({ Symbol: "MSFT", Qty: "+30" });
  });

  it("copes with Windows line endings, commas around the title and a missing section", () => {
    const windows = statement.replace(/\n/g, "\r\n").replace("Account Trade History", ",Account Trade History,");
    expect(thinkorswimTradeHistory(windows)?.rows).toHaveLength(11);
    expect(thinkorswimTradeHistory("Cash Balance\n\nDATE,TIME\n1,2\n")).toBeNull();
    expect(thinkorswimTradeHistory("Account Trade History\n\n")).toBeNull();
  });
});
