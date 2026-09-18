/**
 * Same-origin check for state-changing route handlers. Sibling subdomains are
 * same-site, so SameSite=Lax cookies alone would let another app on the same
 * parent domain post here; the Origin header (or the Referer as a fallback)
 * has to name this app exactly. Pure: no request or environment access.
 */

export type HeaderGetter = (name: string) => string | null | undefined;

/** "https://Example.com/path" -> "https://example.com"; null for anything that is not an http(s) URL. */
export function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The origin browsers must present: APP_ORIGIN when configured, otherwise the
 * request's own Host with the scheme the reverse proxy forwards (http when none).
 */
export function expectedOrigin(get: HeaderGetter, configured: string | undefined): string | null {
  const fixed = normalizeOrigin(configured);
  if (fixed) return fixed;
  const host = get("host")?.trim();
  if (!host) return null;
  const proto = (get("x-forwarded-proto") ?? "").split(",")[0]?.trim().toLowerCase() || "http";
  return normalizeOrigin(`${proto}://${host}`);
}

/**
 * Where the browser says the request came from: the Origin header, else the
 * Referer's origin. Null when neither is present; an unparsable or opaque
 * ("null") value comes back as "null" so that it never matches.
 */
export function presentedOrigin(get: HeaderGetter): string | null {
  const origin = get("origin")?.trim();
  if (origin) return normalizeOrigin(origin) ?? "null";
  const referer = get("referer")?.trim();
  if (referer) return normalizeOrigin(referer) ?? "null";
  return null;
}

export type OriginVerdict = "same" | "missing" | "foreign";

export function originVerdict(get: HeaderGetter, configured: string | undefined): OriginVerdict {
  const presented = presentedOrigin(get);
  if (presented === null) return "missing";
  const expected = expectedOrigin(get, configured);
  return expected !== null && presented === expected ? "same" : "foreign";
}

/**
 * Whether a state-changing request may proceed. A missing Origin is refused
 * unless `allowMissing` is set, which the share target needs because an
 * installed app's share sheet posts a top-level form without one.
 */
export function originAllowed(get: HeaderGetter, configured: string | undefined, options: { allowMissing?: boolean } = {}): boolean {
  const verdict = originVerdict(get, configured);
  return verdict === "same" || (verdict === "missing" && options.allowMissing === true);
}
