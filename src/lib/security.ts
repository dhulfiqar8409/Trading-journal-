/**
 * Small, dependency-free security helpers: constant-time token comparison,
 * the login lockout window and client-IP extraction behind a reverse proxy.
 */
import { timingSafeEqual } from "node:crypto";

export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
export const LOCKOUT_MAX_FAILURES = 5;

/** True when a setup token is configured (non-empty after trimming). */
export function setupTokenRequired(configured: string | undefined): boolean {
  return typeof configured === "string" && configured.trim() !== "";
}

/**
 * Compares a presented token with the configured one in constant time.
 * Different lengths are rejected without comparing bytes.
 */
export function setupTokenMatches(presented: string | null | undefined, configured: string | undefined): boolean {
  if (!setupTokenRequired(configured) || typeof presented !== "string") return false;
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from((configured as string).trim(), "utf8");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/** Failures inside the window, counted from `now` backwards. */
export function failuresInWindow(failureTimes: Date[], now: Date = new Date(), windowMs = LOCKOUT_WINDOW_MS): number {
  const since = now.getTime() - windowMs;
  return failureTimes.filter((t) => t.getTime() > since && t.getTime() <= now.getTime()).length;
}

/** Locked out when the window holds the maximum number of failures or more. */
export function isLockedOut(failureTimes: Date[], now: Date = new Date(), options: { windowMs?: number; maxFailures?: number } = {}): boolean {
  return failuresInWindow(failureTimes, now, options.windowMs ?? LOCKOUT_WINDOW_MS) >= (options.maxFailures ?? LOCKOUT_MAX_FAILURES);
}

/** Time at which the lockout lifts: the oldest failure that still counts plus the window. */
export function lockoutEndsAt(failureTimes: Date[], now: Date = new Date(), windowMs = LOCKOUT_WINDOW_MS, maxFailures = LOCKOUT_MAX_FAILURES): Date | null {
  const since = now.getTime() - windowMs;
  const counted = failureTimes.filter((t) => t.getTime() > since && t.getTime() <= now.getTime()).sort((a, b) => a.getTime() - b.getTime());
  if (counted.length < maxFailures) return null;
  const decisive = counted[counted.length - maxFailures];
  return new Date(decisive.getTime() + windowMs);
}

/**
 * The client address as seen through nginx: X-Real-IP, then the first
 * X-Forwarded-For entry, then the socket address the caller passes in.
 */
export function clientIpFrom(get: (name: string) => string | null | undefined, fallback = "unknown"): string {
  const real = get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  const forwarded = get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  return fallback.slice(0, 64);
}
