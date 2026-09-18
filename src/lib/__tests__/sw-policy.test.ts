import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { beforeAll, describe, expect, it } from "vitest";

interface SwPolicy {
  SHELL_PATHS: string[];
  isShellAsset(pathname: string): boolean;
  forbidsCaching(cacheControl: string | null | undefined): boolean;
  shouldCache(info: { ok: boolean; redirected?: boolean; type?: string; cacheControl?: string | null; mode: string; pathname: string }): boolean;
}

let policy: SwPolicy;

beforeAll(() => {
  // The policy file is a classic script that attaches itself to `self`, the way importScripts runs it in the worker.
  const source = readFileSync(path.resolve(__dirname, "../../../public/sw-policy.js"), "utf8");
  const worker: { self?: unknown; swPolicy?: SwPolicy } = {};
  worker.self = worker;
  runInNewContext(source, worker);
  policy = worker.swPolicy as SwPolicy;
});

const page = (pathname: string, cacheControl: string | null) => ({ ok: true, type: "basic", mode: "navigate", pathname, cacheControl });
const asset = (pathname: string, cacheControl: string | null = "public, max-age=31536000, immutable") => ({ ok: true, type: "basic", mode: "no-cors", pathname, cacheControl });

describe("service worker caching policy", () => {
  it("never caches signed-in pages, whatever their headers say", () => {
    expect(policy.shouldCache(page("/trades", "private, no-cache, no-store, max-age=0, must-revalidate"))).toBe(false);
    expect(policy.shouldCache(page("/settings", null))).toBe(false);
    expect(policy.shouldCache(page("/admin/users", "public, max-age=0"))).toBe(false);
    expect(policy.shouldCache(page("/", null))).toBe(false);
  });

  it("caches only the offline page among navigations", () => {
    expect(policy.shouldCache(page("/offline", "public, max-age=0, must-revalidate"))).toBe(true);
    expect(policy.shouldCache(page("/offline", "private, no-store"))).toBe(false);
  });

  it("caches static shell assets and nothing else", () => {
    expect(policy.shouldCache(asset("/_next/static/chunks/main-abc123.js"))).toBe(true);
    expect(policy.shouldCache(asset("/icons/icon-192.png", "public, max-age=0"))).toBe(true);
    expect(policy.shouldCache(asset("/manifest.webmanifest", null))).toBe(true);
    expect(policy.shouldCache(asset("/api/attachments/abc", "private, no-store"))).toBe(false);
    expect(policy.shouldCache(asset("/api/export/trades", null))).toBe(false);
    expect(policy.shouldCache(asset("/uploads/x.png", null))).toBe(false);
  });

  it("respects no-store and private on anything", () => {
    expect(policy.forbidsCaching("private, max-age=3600")).toBe(true);
    expect(policy.forbidsCaching("No-Store")).toBe(true);
    expect(policy.forbidsCaching("public, max-age=60")).toBe(false);
    expect(policy.forbidsCaching(null)).toBe(false);
    expect(policy.shouldCache(asset("/_next/static/chunks/x.js", "private"))).toBe(false);
  });

  it("skips failures, redirects and opaque responses", () => {
    expect(policy.shouldCache({ ...asset("/_next/static/x.js"), ok: false })).toBe(false);
    expect(policy.shouldCache({ ...page("/offline", null), redirected: true })).toBe(false);
    expect(policy.shouldCache({ ...asset("/_next/static/x.js"), type: "opaque" })).toBe(false);
    expect(policy.shouldCache(null as unknown as Parameters<SwPolicy["shouldCache"]>[0])).toBe(false);
  });

  it("recognises the shell paths", () => {
    for (const p of policy.SHELL_PATHS) expect(policy.isShellAsset(p), p).toBe(true);
    expect(policy.isShellAsset("/trades")).toBe(false);
    expect(policy.isShellAsset("/_next/image?url=x")).toBe(false);
  });
});
