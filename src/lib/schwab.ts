/**
 * Schwab website transaction history exports (Accounts, History, Export):
 * one CSV with Date, Action, Symbol, Description, Quantity, Price, Fees & Comm
 * and Amount, newest first and without a time of day. The Action column mixes
 * fills ("Buy to Open", "Sell to Close", "Buy", "Sell") with cash and
 * corporate entries (Journal, Bank Interest, MoneyLink Transfer, Dividend,
 * Reinvest Shares) and contract events (Expired, Assigned, Exchange or
 * Exercise). Some exports put a title line above the header and a
 * "Transactions Total" line below the rows. This module finds the table and
 * hands its rows to the executions importer. Pure and browser-safe.
 */
import Papa from "papaparse";
import { normalizeHeader } from "@/lib/csv";

export const SCHWAB_FORMAT = "Schwab transaction history";

const REQUIRED = ["date", "action", "symbol", "quantity", "price"];

/** True for the header row of a Schwab transaction history. */
export function isSchwabHeader(headers: string[]): boolean {
  const norm = new Set(headers.map(normalizeHeader));
  return REQUIRED.every((h) => norm.has(h)) && (norm.has("feesandcomm") || norm.has("feescomm") || (norm.has("amount") && norm.has("description")));
}

export interface TransactionSection {
  headers: string[];
  rows: Record<string, string>[];
}

/**
 * The transaction table of a Schwab export: the header line (searched for in
 * the first lines, past any title) and every row after it, as records keyed
 * by header. Lines with neither an action nor a symbol, such as the
 * "Transactions Total" footer, are left out. Null when the text is not a
 * Schwab transaction history.
 */
export function schwabTransactions(text: string): TransactionSection | null {
  const lines = text.split(/\r?\n/);
  const start = lines.slice(0, 20).findIndex((line) => {
    const fields = Papa.parse<string[]>(line).data[0] ?? [];
    return fields.length >= 6 && isSchwabHeader(fields.map(String));
  });
  if (start === -1) return null;
  const parsed = Papa.parse<Record<string, string>>(lines.slice(start).join("\n"), { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
  const headers = (parsed.meta.fields ?? []).map((h) => h.trim()).filter((h) => h !== "");
  const action = headers.find((h) => normalizeHeader(h) === "action");
  const symbol = headers.find((h) => normalizeHeader(h) === "symbol");
  const rows = parsed.data
    .map((record) => {
      const row: Record<string, string> = {};
      for (const h of headers) row[h] = record[h] == null ? "" : String(record[h]).trim();
      return row;
    })
    .filter((row) => (action && row[action] !== "") || (symbol && row[symbol] !== ""));
  return { headers, rows };
}

/** True when the text is a Schwab transaction history export. */
export function isSchwabTransactionHistory(text: string): boolean {
  return schwabTransactions(text) !== null;
}
