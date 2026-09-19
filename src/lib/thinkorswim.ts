/**
 * thinkorswim (Schwab) Account Statement exports: one CSV with several
 * sections (Cash Balance, Account Order History, Account Trade History,
 * Equities, Options, Profits and Losses, ...), each introduced by a title
 * line and its own header. The Account Trade History section lists
 * executions, not trades; this module finds that section and hands its rows
 * to the executions importer. Pure and browser-safe.
 */
import Papa from "papaparse";

export const TRADE_HISTORY_TITLE = "Account Trade History";

function isTitle(line: string, title: string): boolean {
  return line.trim().replace(/^,+|,+$/g, "").trim().toLowerCase() === title.toLowerCase();
}

/** True when the text carries a thinkorswim Account Trade History section with its execution columns. */
export function isThinkorswimStatement(text: string): boolean {
  return text.split(/\r?\n/).some((line) => isTitle(line, TRADE_HISTORY_TITLE)) && /Exec Time/.test(text) && /Pos Effect/.test(text);
}

export interface TradeHistorySection {
  headers: string[];
  rows: Record<string, string>[];
}

/**
 * The Account Trade History section: the header line after the title and
 * every row up to the next blank line, as records keyed by header. The
 * statement's leading unnamed column is dropped. Legs of a multi-leg order
 * carry no Exec Time or Spread of their own in the export; they take the
 * first leg's so each leg becomes a fill at the order's time.
 */
export function thinkorswimTradeHistory(text: string): TradeHistorySection | null {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => isTitle(line, TRADE_HISTORY_TITLE));
  if (start === -1) return null;
  let i = start + 1;
  while (i < lines.length && lines[i].replace(/,/g, "").trim() === "") i++;
  const block: string[] = [];
  for (; i < lines.length; i++) {
    if (lines[i].replace(/,/g, "").trim() === "") break;
    block.push(lines[i]);
  }
  if (block.length < 2) return null;
  const parsed = Papa.parse<Record<string, string>>(block.join("\n"), { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
  const headers = (parsed.meta.fields ?? []).map((h) => h.trim()).filter((h) => h !== "");
  let lastTime = "";
  let lastSpread = "";
  const rows = parsed.data.map((record) => {
    const row: Record<string, string> = {};
    for (const h of headers) row[h] = record[h] == null ? "" : String(record[h]).trim();
    if ("Exec Time" in row) {
      if (row["Exec Time"] === "" && lastTime) {
        row["Exec Time"] = lastTime;
        if (row["Spread"] === "") row["Spread"] = lastSpread;
      } else {
        lastTime = row["Exec Time"];
        lastSpread = row["Spread"] ?? "";
      }
    }
    return row;
  });
  return { headers, rows };
}
