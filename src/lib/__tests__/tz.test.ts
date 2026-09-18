import { describe, expect, it } from "vitest";
import {
  addDaysToKey,
  dateKeyInZone,
  endOfDayInZone,
  fromDateTimeLocalValue,
  isValidTimeZone,
  startOfDayInZone,
  toDateTimeLocalValue,
  wallTimeToUtc,
  zoneOffsetMinutes,
} from "@/lib/tz";

describe("time zone helpers", () => {
  it("validates zone names", () => {
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Europe/London")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });

  it("computes offsets including daylight saving", () => {
    expect(zoneOffsetMinutes(new Date("2024-01-15T12:00:00Z"), "America/New_York")).toBe(-300);
    expect(zoneOffsetMinutes(new Date("2024-07-15T12:00:00Z"), "America/New_York")).toBe(-240);
    expect(zoneOffsetMinutes(new Date("2024-07-15T12:00:00Z"), "Asia/Kolkata")).toBe(330);
    expect(zoneOffsetMinutes(new Date("2024-07-15T12:00:00Z"), "UTC")).toBe(0);
  });

  it("converts wall time to an instant", () => {
    expect(wallTimeToUtc({ year: 2024, month: 3, day: 12, hour: 9, minute: 30 }, "America/New_York").toISOString()).toBe(
      "2024-03-12T13:30:00.000Z",
    );
    expect(wallTimeToUtc({ year: 2024, month: 1, day: 12, hour: 9, minute: 30 }, "America/New_York").toISOString()).toBe(
      "2024-01-12T14:30:00.000Z",
    );
  });

  it("handles the spring-forward gap and the fall-back overlap deterministically", () => {
    // 02:30 does not exist on 2024-03-10 in New York; it maps to a valid instant near the gap.
    const gap = wallTimeToUtc({ year: 2024, month: 3, day: 10, hour: 2, minute: 30 }, "America/New_York");
    expect(Number.isNaN(gap.getTime())).toBe(false);
    expect(Math.abs(gap.getTime() - Date.UTC(2024, 2, 10, 7, 0)) <= 60 * 60 * 1000).toBe(true);
    // 01:30 occurs twice on 2024-11-03; the result is one of the two instants.
    const overlap = wallTimeToUtc({ year: 2024, month: 11, day: 3, hour: 1, minute: 30 }, "America/New_York");
    expect([Date.UTC(2024, 10, 3, 5, 30), Date.UTC(2024, 10, 3, 6, 30)]).toContain(overlap.getTime());
  });

  it("round-trips datetime-local values", () => {
    const instant = new Date("2024-03-12T13:30:00Z");
    const value = toDateTimeLocalValue(instant, "America/New_York");
    expect(value).toBe("2024-03-12T09:30");
    expect(fromDateTimeLocalValue(value, "America/New_York")?.toISOString()).toBe("2024-03-12T13:30:00.000Z");
    expect(fromDateTimeLocalValue("2024-03-12T09:30:15", "UTC")?.toISOString()).toBe("2024-03-12T09:30:15.000Z");
    expect(fromDateTimeLocalValue("garbage", "UTC")).toBeNull();
    expect(fromDateTimeLocalValue("2024-13-12T09:30", "UTC")).toBeNull();
  });

  it("computes day keys and day boundaries in a zone", () => {
    const instant = new Date("2024-03-13T02:00:00Z");
    expect(dateKeyInZone(instant, "UTC")).toBe("2024-03-13");
    expect(dateKeyInZone(instant, "America/Los_Angeles")).toBe("2024-03-12");
    expect(startOfDayInZone("2024-03-12", "America/Los_Angeles").toISOString()).toBe("2024-03-12T07:00:00.000Z");
    expect(endOfDayInZone("2024-03-12", "America/Los_Angeles").toISOString()).toBe("2024-03-13T07:00:00.000Z");
    expect(addDaysToKey("2024-02-28", 2)).toBe("2024-03-01");
    expect(addDaysToKey("2024-01-01", -1)).toBe("2023-12-31");
  });
});
