import { describe, expect, it } from "vitest";
import { dayKeysOfIsoWeek, isoWeekKey, isoWeekLabel, isoWeekOf, isoWeekRange, parseIsoWeekKey, shiftIsoWeek } from "@/lib/weeks";

describe("ISO weeks", () => {
  it("computes week numbers around year boundaries", () => {
    expect(isoWeekOf(2021, 1, 3)).toEqual({ isoYear: 2020, week: 53 });
    expect(isoWeekOf(2021, 1, 4)).toEqual({ isoYear: 2021, week: 1 });
    expect(isoWeekOf(2024, 12, 30)).toEqual({ isoYear: 2025, week: 1 });
    expect(isoWeekOf(2026, 9, 18)).toEqual({ isoYear: 2026, week: 38 });
    expect(isoWeekOf(2027, 1, 1)).toEqual({ isoYear: 2026, week: 53 });
  });

  it("uses the calendar day in the owner's zone", () => {
    const sundayNightNY = new Date("2026-09-21T02:30:00Z"); // still Sunday 22:30 in New York
    expect(isoWeekKey(sundayNightNY, "UTC")).toBe("2026-W39");
    expect(isoWeekKey(sundayNightNY, "America/New_York")).toBe("2026-W38");
  });

  it("parses and rejects week keys", () => {
    expect(parseIsoWeekKey("2026-W38")).toEqual({ isoYear: 2026, week: 38 });
    expect(parseIsoWeekKey("2020-W53")).toEqual({ isoYear: 2020, week: 53 });
    expect(parseIsoWeekKey("2021-W53")).toBeNull();
    expect(parseIsoWeekKey("2026-W00")).toBeNull();
    expect(parseIsoWeekKey("garbage")).toBeNull();
  });

  it("lists the days of a week and its bounds in a zone", () => {
    expect(dayKeysOfIsoWeek("2026-W38")).toEqual(["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"]);
    const range = isoWeekRange("2026-W38", "America/New_York")!;
    expect(range.from.toISOString()).toBe("2026-09-14T04:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-09-21T04:00:00.000Z");
    expect(isoWeekRange("nope", "UTC")).toBeNull();
  });

  it("shifts and labels weeks", () => {
    expect(shiftIsoWeek("2026-W38", 1)).toBe("2026-W39");
    expect(shiftIsoWeek("2026-W01", -1)).toBe("2025-W52");
    expect(shiftIsoWeek("2020-W53", 1)).toBe("2021-W01");
    expect(isoWeekLabel("2026-W38")).toBe("Sep 14 – Sep 20, 2026");
    expect(isoWeekLabel("2020-W53")).toBe("Dec 28, 2020 – Jan 3, 2021");
  });
});
