/**
 * Schwab website order status exports (Accounts, Order Status, Export): one
 * CSV, opening with a UTF-8 byte order mark, that lists every order with
 * Symbol, Strategy Name, Name of Security, Status, Action, Quantity|Face
 * Value, Price, Timing, Fill Price, Fill Price is Average, Time and Date(ET),
 * Last Activity Date(ET), Reinvest Capital Gains and Order Number. Rows are
 * grouped by status (Filled, then partial fills, then Canceled), newest first
 * within a group by the last activity. "Time and Date" is when the order was
 * placed; for a filled order the last activity is its fill, so that column
 * is the fill time. Both are US Eastern whatever the account's zone, and this
 * module makes the cells say so, which survives the trip through the mapping
 * to the server. The rows then go to the executions importer, whose status
 * handling keeps the filled orders and skips the rest. Pure and browser-safe.
 */
import Papa from "papaparse";
import { normalizeHeader } from "@/lib/csv";

export const SCHWAB_ORDERS_FORMAT = "Schwab order status";

const REQUIRED = ["symbol", "status", "action", "fillprice"];

/** True for the header row of a Schwab order status export. */
export function isSchwabOrderStatusHeader(headers: string[]): boolean {
  const norm = headers.map(normalizeHeader);
  const set = new Set(norm);
  return REQUIRED.every((h) => set.has(h)) && (set.has("quantityfacevalue") || set.has("quantity")) && norm.some((h) => /^(?:timeanddate|lastactivitydate)/.test(h));
}

export interface OrderStatusSection {
  headers: string[];
  rows: Record<string, string>[];
}

/** A header that names the zone of its column: "Time and Date(ET)", "Last Activity Date(ET)". */
const ZONE_SUFFIX_RE = /\((ET|EST|EDT|CT|CST|CDT|MT|MST|MDT|PT|PST|PDT)\)\s*$/i;

/**
 * The order table of a Schwab order status export: the header line (searched
 * for in the first lines, past the byte order mark and any title) and every
 * row after it, as records keyed by header. Cells of a column whose header
 * names a zone get that zone appended ("6:37 PM 09/28/2026 ET"). Null when
 * the text is not a Schwab order status export.
 */
export function schwabOrderStatus(text: string): OrderStatusSection | null {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const start = lines.slice(0, 20).findIndex((line) => {
    const fields = Papa.parse<string[]>(line).data[0] ?? [];
    return fields.length >= 6 && isSchwabOrderStatusHeader(fields.map(String));
  });
  if (start === -1) return null;
  const parsed = Papa.parse<Record<string, string>>(lines.slice(start).join("\n"), { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
  const headers = (parsed.meta.fields ?? []).map((h) => h.trim()).filter((h) => h !== "");
  const zoned = headers.flatMap((h) => {
    const m = ZONE_SUFFIX_RE.exec(h);
    return m ? [[h, m[1].toUpperCase()] as const] : [];
  });
  const symbol = headers.find((h) => normalizeHeader(h) === "symbol");
  const action = headers.find((h) => normalizeHeader(h) === "action");
  const rows = parsed.data
    .map((record) => {
      const row: Record<string, string> = {};
      for (const h of headers) row[h] = record[h] == null ? "" : String(record[h]).trim();
      for (const [h, zone] of zoned) if (/\d$/.test(row[h])) row[h] = `${row[h]} ${zone}`;
      return row;
    })
    .filter((row) => (symbol && row[symbol] !== "") || (action && row[action] !== ""));
  return { headers, rows };
}

/** True when the text is a Schwab order status export. */
export function isSchwabOrderStatus(text: string): boolean {
  return schwabOrderStatus(text) !== null;
}
