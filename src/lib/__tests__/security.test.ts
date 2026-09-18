import { describe, expect, it } from "vitest";
import { clientIpFrom, failuresInWindow, isLockedOut, lockoutEndsAt, setupTokenMatches, setupTokenRequired } from "@/lib/security";

describe("setup token", () => {
  it("is only required when configured and non-empty", () => {
    expect(setupTokenRequired(undefined)).toBe(false);
    expect(setupTokenRequired("")).toBe(false);
    expect(setupTokenRequired("   ")).toBe(false);
    expect(setupTokenRequired("abc")).toBe(true);
  });

  it("matches only the exact token", () => {
    expect(setupTokenMatches("s3cret-token", "s3cret-token")).toBe(true);
    expect(setupTokenMatches("s3cret-token", " s3cret-token ")).toBe(true); // configured value is trimmed
    expect(setupTokenMatches("s3cret-tokeN", "s3cret-token")).toBe(false);
    expect(setupTokenMatches("s3cret-toke", "s3cret-token")).toBe(false); // different length
    expect(setupTokenMatches("", "s3cret-token")).toBe(false);
    expect(setupTokenMatches(null, "s3cret-token")).toBe(false);
    expect(setupTokenMatches(undefined, "s3cret-token")).toBe(false);
    expect(setupTokenMatches("anything", undefined)).toBe(false); // nothing configured never matches
    expect(setupTokenMatches("", "")).toBe(false);
  });
});

describe("login lockout", () => {
  const now = new Date("2026-09-18T12:00:00Z");
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60000);

  it("counts only failures inside the window", () => {
    const failures = [minutesAgo(20), minutesAgo(14), minutesAgo(5), minutesAgo(0.5), new Date(now.getTime() + 60000)];
    expect(failuresInWindow(failures, now)).toBe(3); // the 20-minute-old one and the future one do not count
    expect(failuresInWindow([], now)).toBe(0);
  });

  it("locks out at five failures within fifteen minutes and lifts afterwards", () => {
    const four = [minutesAgo(14), minutesAgo(10), minutesAgo(6), minutesAgo(1)];
    expect(isLockedOut(four, now)).toBe(false);
    const five = [...four, minutesAgo(0.2)];
    expect(isLockedOut(five, now)).toBe(true);
    expect(lockoutEndsAt(five, now)?.toISOString()).toBe(new Date(minutesAgo(14).getTime() + 15 * 60000).toISOString());
    // A minute later the oldest failure falls out of the window and the account unlocks.
    const later = new Date(now.getTime() + 61 * 1000);
    expect(isLockedOut(five, later)).toBe(false);
    expect(lockoutEndsAt(four, now)).toBeNull();
  });

  it("supports custom thresholds", () => {
    expect(isLockedOut([minutesAgo(1), minutesAgo(2)], now, { maxFailures: 2 })).toBe(true);
    expect(isLockedOut([minutesAgo(1), minutesAgo(2)], now, { windowMs: 60 * 1000, maxFailures: 2 })).toBe(false);
  });
});

describe("client IP", () => {
  const headers = (map: Record<string, string>) => (name: string) => map[name] ?? null;

  it("prefers X-Real-IP, then the first X-Forwarded-For entry, then the socket address", () => {
    expect(clientIpFrom(headers({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.1, 10.0.0.1" }), "127.0.0.1")).toBe("203.0.113.9");
    expect(clientIpFrom(headers({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" }), "127.0.0.1")).toBe("198.51.100.1");
    expect(clientIpFrom(headers({ "x-forwarded-for": " , " }), "127.0.0.1")).toBe("127.0.0.1");
    expect(clientIpFrom(headers({}), "127.0.0.1")).toBe("127.0.0.1");
    expect(clientIpFrom(headers({}))).toBe("unknown");
    expect(clientIpFrom(headers({ "x-real-ip": "x".repeat(100) })).length).toBe(64);
  });
});
