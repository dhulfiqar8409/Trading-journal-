import { describe, expect, it } from "vitest";
import { combineDateAndTime, hasTimeOfDay, isClockTime, parseFlexibleDate } from "@/lib/dates";

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

  it("reads US market zone abbreviations, daylight saving included, ahead of the requested zone", () => {
    expect(iso("09/17/2026 09:31:05 AM ET", { timeZone: "UTC" })).toBe("2026-09-17T13:31:05.000Z"); // EDT in September
    expect(iso("01/15/2026 09:31 ET", { timeZone: "Asia/Tokyo" })).toBe("2026-01-15T14:31:00.000Z"); // EST in January
    expect(iso("09/17/2026 09:31 EST")).toBe("2026-09-17T14:31:00.000Z"); // a fixed offset, as written
    expect(iso("09/17/2026 09:31 EDT")).toBe("2026-09-17T13:31:00.000Z");
    expect(iso("09/17/2026 09:31 CT")).toBe("2026-09-17T14:31:00.000Z");
    expect(iso("09/17/2026 09:31 pt")).toBe("2026-09-17T16:31:00.000Z");
    expect(iso("09/17/2026 09:31 GMT")).toBe("2026-09-17T09:31:00.000Z");
    // A month name is not a zone.
    expect(iso("12 Oct 2024")).toBe("2024-10-12T00:00:00.000Z");
    expect(iso("12 Sept 2024 09:31")).toBe("2024-09-12T09:31:00.000Z");
  });

  it("reads a clock that comes before its date, as a Schwab order status writes it", () => {
    expect(iso("6:37 PM 09/28/2026")).toBe("2026-09-28T18:37:00.000Z");
    expect(iso("6:37 PM 09/28/2026 ET")).toBe("2026-09-28T22:37:00.000Z");
    expect(iso("10:02 AM 09/18/2026 ET")).toBe("2026-09-18T14:02:00.000Z");
    expect(iso("09:31:05 2026-09-17")).toBe("2026-09-17T09:31:05.000Z");
    expect(iso("6:37 PM")).toBeNull();
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

describe("dates with an 'as of' suffix and the time-of-day check", () => {
  it("uses the first date of a posting-date pair", () => {
    expect(iso("09/14/2026 as of 09/12/2026")).toBe("2026-09-14T00:00:00.000Z");
    expect(iso("09/14/2026 AS OF 09/12/2026", { timeZone: "America/New_York" })).toBe("2026-09-14T04:00:00.000Z");
    expect(iso("as of 09/12/2026")).toBeNull();
  });

  it("tells a clock time from a bare date", () => {
    expect(hasTimeOfDay("9/17/26 09:31:05")).toBe(true);
    expect(hasTimeOfDay("2026-09-17T13:31:05Z")).toBe(true);
    expect(hasTimeOfDay("1758115865")).toBe(true);
    expect(hasTimeOfDay("09/17/2026")).toBe(false);
    expect(hasTimeOfDay("09/14/2026 as of 09/12/2026")).toBe(false);
    expect(hasTimeOfDay("20 SEP 26")).toBe(false);
  });
});

describe("separate date and clock columns", () => {
  it("recognises a clock on its own", () => {
    for (const v of ["09:31:05", "9:31", "9:31 AM", "09:31:05 ET", "3:45:10 PM ET", "15:10:00-04:00", "09:31:05.250 Z"]) expect(isClockTime(v), v).toBe(true);
    for (const v of ["09/17/2026", "9/17/26 09:31:05", "6:37 PM 09/28/2026", "1758115865", "", "noon"]) expect(isClockTime(v), v).toBe(false);
  });

  it("joins a date cell and a clock cell, and leaves a complete cell alone", () => {
    expect(combineDateAndTime("09/17/2026", "09:31:05 AM ET")).toBe("09/17/2026 09:31:05 AM ET");
    expect(iso(combineDateAndTime("09/17/2026", "09:31:05 AM ET"))).toBe("2026-09-17T13:31:05.000Z");
    expect(iso(combineDateAndTime("2026-09-17", "9:31 PM"), { timeZone: "America/New_York" })).toBe("2026-09-18T01:31:00.000Z");
    expect(combineDateAndTime("09/17/2026", "")).toBe("09/17/2026");
    expect(combineDateAndTime("", "09:31:05")).toBe("09:31:05");
    expect(combineDateAndTime("9/17/26 09:31:05", "10:00")).toBe("9/17/26 09:31:05"); // the date already carries the clock
    expect(combineDateAndTime("09/17/2026", "9/17/26 09:31:05")).toBe("9/17/26 09:31:05"); // the clock column is a full date-time
    expect(combineDateAndTime("09/17/2026", "sometime")).toBe("09/17/2026 sometime"); // left for the error message
  });
});
