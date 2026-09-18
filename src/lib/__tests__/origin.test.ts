import { describe, expect, it } from "vitest";
import { expectedOrigin, normalizeOrigin, originAllowed, originVerdict, presentedOrigin } from "@/lib/origin";

const headers = (map: Record<string, string>) => (name: string) => map[name.toLowerCase()] ?? null;

describe("origin normalisation", () => {
  it("keeps scheme and host only, lowercased", () => {
    expect(normalizeOrigin("https://Darkpools.deeapps.net/")).toBe("https://darkpools.deeapps.net");
    expect(normalizeOrigin("http://127.0.0.1:3000/trades?x=1")).toBe("http://127.0.0.1:3000");
    expect(normalizeOrigin(" https://a.example ")).toBe("https://a.example");
  });

  it("rejects non-http values", () => {
    expect(normalizeOrigin("null")).toBeNull();
    expect(normalizeOrigin("javascript:alert(1)")).toBeNull();
    expect(normalizeOrigin("darkpools.deeapps.net")).toBeNull();
    expect(normalizeOrigin("")).toBeNull();
    expect(normalizeOrigin(undefined)).toBeNull();
  });
});

describe("expected origin", () => {
  it("prefers APP_ORIGIN over the request", () => {
    expect(expectedOrigin(headers({ host: "evil.example", "x-forwarded-proto": "https" }), "https://darkpools.deeapps.net/")).toBe("https://darkpools.deeapps.net");
  });

  it("derives it from Host and X-Forwarded-Proto otherwise", () => {
    expect(expectedOrigin(headers({ host: "darkpools.deeapps.net", "x-forwarded-proto": "https" }), undefined)).toBe("https://darkpools.deeapps.net");
    expect(expectedOrigin(headers({ host: "darkpools.deeapps.net", "x-forwarded-proto": "https, http" }), "")).toBe("https://darkpools.deeapps.net");
    expect(expectedOrigin(headers({ host: "127.0.0.1:3000" }), undefined)).toBe("http://127.0.0.1:3000");
    expect(expectedOrigin(headers({}), undefined)).toBeNull();
  });
});

describe("presented origin", () => {
  it("uses Origin, then the Referer's origin", () => {
    expect(presentedOrigin(headers({ origin: "https://Darkpools.deeapps.net", referer: "https://other.example/x" }))).toBe("https://darkpools.deeapps.net");
    expect(presentedOrigin(headers({ referer: "https://darkpools.deeapps.net/trades/new" }))).toBe("https://darkpools.deeapps.net");
    expect(presentedOrigin(headers({}))).toBeNull();
  });

  it("turns opaque or broken values into something that never matches", () => {
    expect(presentedOrigin(headers({ origin: "null" }))).toBe("null");
    expect(presentedOrigin(headers({ referer: "not a url" }))).toBe("null");
  });
});

describe("verdict and allowance", () => {
  const app = "https://darkpools.deeapps.net";
  const req = (origin?: string, referer?: string) => headers({ host: "darkpools.deeapps.net", "x-forwarded-proto": "https", ...(origin ? { origin } : {}), ...(referer ? { referer } : {}) });

  it("accepts the app's own origin, from APP_ORIGIN or from the request", () => {
    expect(originVerdict(req("https://darkpools.deeapps.net"), app)).toBe("same");
    expect(originVerdict(req("https://darkpools.deeapps.net"), undefined)).toBe("same");
    expect(originAllowed(req(undefined, "https://darkpools.deeapps.net/import"), app)).toBe(true);
  });

  it("refuses sibling subdomains, other schemes and opaque origins", () => {
    expect(originVerdict(req("https://kcal.deeapps.net"), app)).toBe("foreign");
    expect(originVerdict(req("http://darkpools.deeapps.net"), app)).toBe("foreign");
    expect(originVerdict(req("https://darkpools.deeapps.net.evil.example"), app)).toBe("foreign");
    expect(originVerdict(req("null"), app)).toBe("foreign");
    expect(originAllowed(req("https://kcal.deeapps.net"), app, { allowMissing: true })).toBe(false);
  });

  it("treats a missing origin as refused unless explicitly allowed", () => {
    expect(originVerdict(req(), app)).toBe("missing");
    expect(originAllowed(req(), app)).toBe(false);
    expect(originAllowed(req(), app, { allowMissing: true })).toBe(true);
  });

  it("never matches when the expected origin cannot be determined", () => {
    expect(originVerdict(headers({ origin: "https://a.example" }), undefined)).toBe("foreign");
  });
});
