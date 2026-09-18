import { describe, expect, it } from "vitest";
import { parseFlexibleDate } from "@/lib/dates";

const iso = (s: string, opts?: Parameters<typeof parseFlexibleDate>[1]) => parseFlexibleDate(s, opts)?.toISOString() ?? null;

describe("parseFlexibleDate", () => {
  it("parses ISO 8601 with and without offsets", () => {
    expect(iso("2024-03-12T14:30:00Z")).toBe("2024-03-12T14:30:00.000Z");
    expect(iso("2024-03-12T14:30:00.250Z")).toBe("2024-03-12T14:30:00.250Z");
    expect(iso("2024-03-12T09:30:00-05:00")).toBe("2024-03-12T14:30:00.000Z");
    expect(iso("2024-03-12T16:30+0200")).toBe("2024-03-12T14:30:00.000Z");
    expect(iso("2024-03-12T14:30:00")).toBe("2024-03-12T14:30:00.000Z");
    expect(iso("2024-03-12 14:30")).toBe("2024-03-12T14:30:00.000Z");
    expect(iso("2024-03-12")).toBe("2024-03-12T00:00:00.000Z");
    expect(iso("2024/03/12 14:30:15")).toBe("2024-03-12T14:30:15.000Z");
    expect(iso("20240312")).toBe("2024-03-12T00:00:00.000Z");
  });

  it("parses US formats with 12-hour clocks", () => {
    expect(iso("03/12/2024")).toBe("2024-03-12T00:00:00.000Z");
    expect(iso("3/12/2024 2:30 PM")).toBe("2024-03-12T14:30:00.000Z");
    expect(iso("3/12/2024 12:05 AM")).toBe("2024-03-12T00:05:00.000Z");
    expect(iso("3/12/2024 12:05 PM")).toBe("2024-03-12T12:05:00.000Z");
    expect(iso("03/12/24 14:30:05")).toBe("2024-03-12T14:30:05.000Z");
    expect(iso("3-12-2024")).toBe("2024-03-12T00:00:00.000Z");
  });

  it("supports day-first formats", () => {
    expect(iso("12/03/2024", { dayFirst: true })).toBe("2024-03-12T00:00:00.000Z");
    expect(iso("12.03.2024 14:30")).toBe("2024-03-12T14:30:00.000Z");
    // Impossible month-first dates fall back to day-first automatically.
    expect(iso("25/03/2024")).toBe("2024-03-25T00:00:00.000Z");
  });

  it("parses month names", () => {
    expect(iso("12 Mar 2024")).toBe("2024-03-12T00:00:00.000Z");
    expect(iso("12-Mar-2024 09:15")).toBe("2024-03-12T09:15:00.000Z");
    expect(iso("Mar 12, 2024 9:15 am")).toBe("2024-03-12T09:15:00.000Z");
    expect(iso("March 12 2024")).toBe("2024-03-12T00:00:00.000Z");
  });

  it("parses unix timestamps", () => {
    expect(iso("1710253800")).toBe("2024-03-12T14:30:00.000Z");
    expect(iso("1710253800000")).toBe("2024-03-12T14:30:00.000Z");
  });

  it("interprets offset-less values in the requested zone", () => {
    expect(iso("2024-03-12 09:30", { timeZone: "America/New_York" })).toBe("2024-03-12T13:30:00.000Z");
    // But explicit offsets always win.
    expect(iso("2024-03-12 09:30Z", { timeZone: "America/New_York" })).toBe("2024-03-12T09:30:00.000Z");
    expect(iso("2024-11-03 01:30", { timeZone: "America/New_York" })).toBe("2024-11-03T05:30:00.000Z");
  });

  it("rejects garbage and impossible dates", () => {
    expect(iso("")).toBeNull();
    expect(iso("not a date")).toBeNull();
    expect(iso("2024-13-01")).toBeNull();
    expect(iso("2024-02-30")).toBeNull();
    expect(iso("13/13/2024")).toBeNull();
    expect(iso("2024-03-12 25:00")).toBeNull();
    expect(iso("3/12/2024 13:00 PM")).toBeNull();
  });
});
