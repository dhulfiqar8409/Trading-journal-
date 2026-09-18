export type SearchParams = Record<string, string | string[] | undefined>;

/** First value of each search param, as a flat string record. */
export function flattenSearchParams(params: SearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    const v = Array.isArray(value) ? value[0] : value;
    if (typeof v === "string") out[key] = v;
  }
  return out;
}

/** Build a query string from the current params with overrides; empty values drop the key. */
export function withParams(current: Record<string, string>, overrides: Record<string, string | number | null | undefined>): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) if (v !== "") next.set(k, v);
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null || v === undefined || v === "") next.delete(k);
    else next.set(k, String(v));
  }
  const s = next.toString();
  return s ? `?${s}` : "";
}
