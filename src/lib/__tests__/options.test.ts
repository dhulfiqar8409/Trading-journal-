import { describe, expect, it } from "vitest";
import {
  daysToExpiration,
  dteBucket,
  expirationCloseTime,
  expirationInstant,
  expirationKey,
  formatOptionLabel,
  formatStrike,
  parseOptionSymbol,
  tradeLabel,
} from "@/lib/options";

const NY = "America/New_York";
const spy = { symbol: "SPY", assetClass: "OPTION", optionType: "CALL" as const, strikePrice: "450.00000000", expiresAt: "2024-09-20T12:00:00.000Z" };

describe("expiration days", () => {
  it("stores a calendar day at noon UTC and reads it back in any zone", () => {
    expect(expirationInstant("2024-09-20")?.toISOString()).toBe("2024-09-20T12:00:00.000Z");
    expect(expirationKey(expirationInstant("2024-09-20") as Date)).toBe("2024-09-20");
    expect(expirationKey("2024-09-20T12:00:00.000Z")).toBe("2024-09-20");
    expect(expirationInstant("2024-02-30")).toBeNull();
    expect(expirationInstant("20240920")).toBeNull();
    expect(expirationInstant("")).toBeNull();
  });

  it("closes an expired contract at 16:00 in the owner's zone, daylight saving included", () => {
    expect(expirationCloseTime("2024-09-20T12:00:00.000Z", NY).toISOString()).toBe("2024-09-20T20:00:00.000Z");
    expect(expirationCloseTime("2024-01-19T12:00:00.000Z", NY).toISOString()).toBe("2024-01-19T21:00:00.000Z");
    expect(expirationCloseTime("2024-09-20T12:00:00.000Z", "UTC").toISOString()).toBe("2024-09-20T16:00:00.000Z");
  });

  it("counts calendar days to expiration from the entry day", () => {
    expect(daysToExpiration(new Date("2024-09-06T13:35:00Z"), "2024-09-20T12:00:00.000Z", NY)).toBe(14);
    expect(daysToExpiration(new Date("2024-09-20T19:55:00Z"), "2024-09-20T12:00:00.000Z", NY)).toBe(0);
    // 23:30 in New York is the next day in UTC; the owner's zone decides.
    expect(daysToExpiration(new Date("2024-09-20T03:30:00Z"), "2024-09-20T12:00:00.000Z", NY)).toBe(1);
    expect(daysToExpiration(new Date("2024-09-25T13:35:00Z"), "2024-09-20T12:00:00.000Z", NY)).toBe(-5);
  });

  it("buckets days to expiration as 0, 1 to 7, 8 to 30 and 31 or more", () => {
    expect(dteBucket(0).key).toBe("0");
    expect(dteBucket(-3).key).toBe("0");
    expect(dteBucket(1).key).toBe("1-7");
    expect(dteBucket(7).key).toBe("1-7");
    expect(dteBucket(8).key).toBe("8-30");
    expect(dteBucket(30).key).toBe("8-30");
    expect(dteBucket(31).key).toBe("31+");
    expect(dteBucket(400).label).toBe("31 days or more");
  });
});

describe("labels", () => {
  it("renders the contract as underlying, strike, C or P and expiration day", () => {
    expect(formatOptionLabel(spy, new Date("2024-06-01T00:00:00Z"))).toBe("SPY 450C Sep 20");
    expect(formatOptionLabel({ ...spy, symbol: "QQQ", optionType: "PUT", strikePrice: "452.50" }, new Date("2024-06-01T00:00:00Z"))).toBe("QQQ 452.5P Sep 20");
    expect(formatStrike("0.50000000")).toBe("0.5");
  });

  it("adds the year when the contract expires in another year", () => {
    expect(formatOptionLabel(spy, new Date("2026-06-01T00:00:00Z"))).toBe("SPY 450C Sep 20 '24");
  });

  it("falls back to the symbol for everything that is not a complete option", () => {
    expect(tradeLabel({ symbol: "AAPL", assetClass: "STOCK", optionType: null, strikePrice: null, expiresAt: null })).toBe("AAPL");
    expect(tradeLabel({ ...spy, assetClass: "STOCK" })).toBe("SPY");
    expect(tradeLabel({ ...spy, strikePrice: null })).toBe("SPY");
    expect(tradeLabel(spy, new Date("2024-06-01T00:00:00Z"))).toBe("SPY 450C Sep 20");
  });
});

describe("parseOptionSymbol", () => {
  const expected = { underlying: "SPY", expiration: "2024-09-20", optionType: "CALL", strike: "450" };

  it("reads OCC and OSI symbols, padded roots and platform shorthand", () => {
    expect(parseOptionSymbol("SPY240920C00450000")).toEqual(expected);
    expect(parseOptionSymbol("SPY   240920C00450000")).toEqual(expected);
    expect(parseOptionSymbol("spy240920p00452500")).toEqual({ ...expected, optionType: "PUT", strike: "452.5" });
    expect(parseOptionSymbol(".SPY240920C450")).toEqual(expected);
    expect(parseOptionSymbol("SPY240920C452.5")).toEqual({ ...expected, strike: "452.5" });
  });

  it("reads broker text in several orders and date styles", () => {
    expect(parseOptionSymbol("SPY 09/20/2024 450 C")).toEqual(expected);
    expect(parseOptionSymbol("SPY 09/20/24 450 CALL")).toEqual(expected);
    expect(parseOptionSymbol("SPY 20SEP24 450 P")).toEqual({ ...expected, optionType: "PUT" });
    expect(parseOptionSymbol("SPY 20-Sep-2024 450 Put")).toEqual({ ...expected, optionType: "PUT" });
    expect(parseOptionSymbol("SPY SEP 20 2024 450 CALL")).toEqual(expected);
    expect(parseOptionSymbol("SPY 20 SEP 2024 $450 C")).toEqual(expected);
    expect(parseOptionSymbol("SPY 450C 09/20/2024")).toEqual(expected);
    expect(parseOptionSymbol("SPY 2024-09-20 C 450")).toEqual(expected);
    expect(parseOptionSymbol("SPY_092024_450C")).toBeNull(); // month-year only is not a day
  });

  it("leaves plain symbols and incomplete contracts alone", () => {
    for (const plain of ["AAPL", "ESZ4", "BTCUSD", "SPY 450", "SPY 09/20/2024 C", "SPY 09/20/2024 450", "SPY 450C 450P 09/20/2024", "SPY 02/30/2024 450 C", ""]) {
      expect(parseOptionSymbol(plain), plain).toBeNull();
    }
  });
});
