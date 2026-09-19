/**
 * CSV import: column auto-detection and row parsing. Pure and browser-safe so
 * the same code produces the preview in the browser and the final rows on the
 * server (which is the source of truth).
 */

import { Decimal, toDecimal } from "@/lib/decimal";
import { parseFlexibleDate } from "@/lib/dates";
import { importHashKey } from "@/lib/import-hash-key";
import { expirationInstant, OPTION_MULTIPLIER, parseOptionSymbol, type OptionType } from "@/lib/options";
import { exitPriceForNetPnl, netPnl, rMultiple, type Side } from "@/lib/pnl";

export const ASSET_CLASSES = ["STOCK", "OPTION", "FUTURES", "FOREX", "CRYPTO"] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

export const IMPORT_FIELDS = [
  "symbol",
  "side",
  "quantity",
  "entryPrice",
  "exitPrice",
  "entryAt",
  "exitAt",
  "fees",
  "pnl",
  "assetClass",
  "multiplier",
  "stopPrice",
  "targetPrice",
  "optionType",
  "strikePrice",
  "expiresAt",
  "notes",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const FIELD_INFO: Record<ImportField, { label: string; required: boolean; hint: string }> = {
  symbol: { label: "Symbol", required: true, hint: "Ticker or contract, e.g. AAPL, ESZ4" },
  side: { label: "Side", required: false, hint: "long/short or buy/sell. Defaults to long" },
  quantity: { label: "Quantity", required: true, hint: "Shares, contracts or units" },
  entryPrice: { label: "Entry price", required: true, hint: "Average fill price in" },
  exitPrice: { label: "Exit price", required: false, hint: "Average fill price out. Empty means the trade is still open" },
  entryAt: { label: "Entry time", required: true, hint: "Date or date-time the position was opened" },
  exitAt: { label: "Exit time", required: false, hint: "Defaults to the entry time when only an exit price is given" },
  fees: { label: "Fees", required: false, hint: "Total commissions and fees. Defaults to 0" },
  pnl: { label: "Net P&L", required: false, hint: "Used to derive the exit price when the file has no exit price column" },
  assetClass: { label: "Asset class", required: false, hint: "stock, option, futures, forex or crypto" },
  multiplier: { label: "Multiplier", required: false, hint: "Point value or contract size. Defaults to the value chosen below" },
  stopPrice: { label: "Stop price", required: false, hint: "Initial stop, used for R-multiples" },
  targetPrice: { label: "Target price", required: false, hint: "Planned target" },
  optionType: { label: "Call / put", required: false, hint: "Options: call or put. Read from the symbol when it names the contract" },
  strikePrice: { label: "Strike", required: false, hint: "Options: strike price" },
  expiresAt: { label: "Expiration", required: false, hint: "Options: expiration date" },
  notes: { label: "Notes", required: false, hint: "Free text appended to the trade notes" },
};

/** Maps each import field to a CSV header. */
export type ColumnMapping = Partial<Record<ImportField, string>>;

export interface ImportOptions {
  defaultAssetClass?: AssetClass;
  defaultMultiplier?: string;
  dayFirst?: boolean;
  /** Zone for dates that carry no offset. Defaults to UTC. */
  timeZone?: string;
}

export interface ParsedImportRow {
  symbol: string;
  side: Side;
  assetClass: AssetClass;
  quantity: string;
  entryPrice: string;
  exitPrice: string | null;
  multiplier: string;
  fees: string;
  entryAt: Date;
  exitAt: Date | null;
  status: "OPEN" | "CLOSED";
  pnl: string | null;
  rMultiple: string | null;
  stopPrice: string | null;
  targetPrice: string | null;
  /** Options only; null for everything else. */
  optionType: OptionType | null;
  strikePrice: string | null;
  expiresAt: Date | null;
  notes: string;
  /** Canonical identity used for de-duplication. */
  importHashKey: string;
}

export type RowResult = { ok: true; row: ParsedImportRow } | { ok: false; error: string };

export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
}

const SYNONYMS: Record<ImportField, string[]> = {
  symbol: ["symbol", "ticker", "instrument", "contract", "underlying", "security", "asset", "sym", "market", "pair", "product", "epic", "name"],
  side: ["side", "direction", "position", "longshort", "buysell", "bs", "ls", "action", "tradetype", "type", "buyorsell", "orderside"],
  quantity: ["quantity", "qty", "size", "shares", "contracts", "units", "lots", "volume", "positionsize", "filledqty", "amount", "filled", "qtyfilled", "numberofcontracts"],
  entryPrice: ["entryprice", "entry", "openprice", "avgentry", "averageentry", "avgentryprice", "buyprice", "pricein", "openingprice", "entryavg", "costbasis", "open", "tradeprice", "tprice", "avgprice", "fillprice", "boughtprice", "openlevel", "price"],
  exitPrice: ["exitprice", "exit", "closeprice", "avgexit", "averageexit", "avgexitprice", "sellprice", "priceout", "closingprice", "exitavg", "close", "soldprice", "closelevel"],
  entryAt: ["entrydate", "entrytime", "entrydatetime", "entrytimestamp", "opendate", "opentime", "opendatetime", "opened", "dateopened", "openedat", "entryat", "boughttimestamp", "datetime", "timestamp", "date", "time", "tradedate", "opentimestamp", "exectime", "executiontime", "filltime", "boughtat", "opendatetimeutc"],
  exitAt: ["exitdate", "exittime", "exitdatetime", "exittimestamp", "closedate", "closetime", "closedatetime", "closed", "dateclosed", "closedat", "exitat", "soldtimestamp", "closetimestamp", "soldat", "closedatetimeutc"],
  fees: ["fees", "fee", "commission", "commissions", "comm", "feesandcommissions", "totalfees", "commissionsandfees", "cost", "commfee", "commandfee", "commissionfee", "charges"],
  pnl: ["pnl", "pandl", "pl", "netpnl", "netpandl", "netpl", "profit", "profitloss", "profitandloss", "realizedpnl", "realizedpandl", "realized", "netprofit", "gain", "gainloss", "result", "net", "return", "realizedpl", "profitlossusd", "plusd", "netpnlusd"],
  assetClass: ["assetclass", "assettype", "instrumenttype", "producttype", "product", "securitytype", "class", "type"],
  multiplier: ["multiplier", "pointvalue", "contractsize", "contractmultiplier", "lotsize", "tickvalue"],
  stopPrice: ["stopprice", "stop", "stoploss", "sl", "initialstop", "stopprice1"],
  targetPrice: ["targetprice", "target", "takeprofit", "tp", "profittarget"],
  optionType: ["optiontype", "putcall", "callput", "putorcall", "callorput", "right", "cp", "pc", "optionkind", "contracttype"],
  strikePrice: ["strike", "strikeprice", "strikeprc", "exerciseprice", "strk"],
  expiresAt: ["expiration", "expirationdate", "expiry", "expirydate", "expdate", "expires", "exp", "maturity", "expirationdt", "expdt"],
  notes: ["notes", "note", "comment", "comments", "description", "remarks", "journal", "memo"],
};

/**
 * Guess which CSV header feeds each field, for any field set with its own
 * synonyms: exact matches first in field priority order, then substring
 * matches for what is still unmapped (e.g. "entry_price_usd"). Each header is
 * used at most once.
 */
export function guessMappingFor<F extends string>(headers: string[], fields: readonly F[], synonyms: Record<F, string[]>): Partial<Record<F, string>> {
  const mapping: Partial<Record<F, string>> = {};
  const used = new Set<string>();
  const normalized = headers.map((h) => ({ header: h, norm: normalizeHeader(h) }));
  for (const field of fields) {
    for (const synonym of synonyms[field]) {
      const hit = normalized.find((h) => h.norm === synonym && !used.has(h.header));
      if (hit) {
        mapping[field] = hit.header;
        used.add(hit.header);
        break;
      }
    }
  }
  for (const field of fields) {
    if (mapping[field]) continue;
    for (const synonym of synonyms[field]) {
      if (synonym.length < 4) continue;
      const hit = normalized.find((h) => h.norm.includes(synonym) && !used.has(h.header));
      if (hit) {
        mapping[field] = hit.header;
        used.add(hit.header);
        break;
      }
    }
  }
  return mapping;
}

/** Guess which CSV header feeds each import field (one row per trade). */
export function guessMapping(headers: string[]): ColumnMapping {
  return guessMappingFor(headers, IMPORT_FIELDS, SYNONYMS);
}

export function parseSide(raw: string): Side | null {
  const v = raw.trim().toLowerCase();
  if (["long", "buy", "b", "l", "bought", "bot", "bto", "buy to open", "buytoopen", "purchase"].includes(v)) return "LONG";
  if (["short", "sell", "s", "sh", "sold", "sld", "sto", "sell short", "sellshort", "sell to open", "selltoopen"].includes(v)) return "SHORT";
  return null;
}

export function parseOptionType(raw: string): OptionType | null {
  const v = raw.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (["c", "call", "calls"].includes(v)) return "CALL";
  if (["p", "put", "puts"].includes(v)) return "PUT";
  return null;
}

export function parseAssetClass(raw: string): AssetClass | null {
  const v = raw.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (["stock", "stocks", "equity", "equities", "share", "shares", "etf", "stk"].includes(v)) return "STOCK";
  if (["option", "options", "opt", "call", "put", "calls", "puts"].includes(v)) return "OPTION";
  if (["future", "futures", "fut", "micro", "index"].includes(v)) return "FUTURES";
  if (["forex", "fx", "currency", "currencies", "cfd"].includes(v)) return "FOREX";
  if (["crypto", "cryptocurrency", "cryptocurrencies", "coin", "spot"].includes(v)) return "CRYPTO";
  return null;
}

/** Parse a money/number cell like "$1,234.50", "(12.50)", "-12.5" or "1 234,5" into a canonical decimal string. */
export function parseNumber(raw: string): string | null {
  let v = raw.trim();
  if (!v) return null;
  let negative = false;
  if (/^\(.*\)$/.test(v)) {
    negative = true;
    v = v.slice(1, -1);
  }
  v = v.replace(/[$€£¥\s]/g, "").replace(/[A-Za-z]+$/, "");
  if (v.startsWith("-")) {
    negative = !negative;
    v = v.slice(1);
  } else if (v.startsWith("+")) {
    v = v.slice(1);
  }
  // "1.234,56" (decimal comma) vs "1,234.56" (thousands comma).
  if (/^\d{1,3}(\.\d{3})+,\d+$/.test(v)) {
    v = v.replace(/\./g, "").replace(",", ".");
  } else if (/^\d+,\d{1,2}$/.test(v)) {
    v = v.replace(",", ".");
  } else {
    v = v.replace(/,/g, "");
  }
  if (!/^\d*\.?\d+$/.test(v) && !/^\d+\.$/.test(v)) return null;
  const d = new Decimal(v);
  return (negative ? d.neg() : d).toFixed();
}

function cell(record: Record<string, string>, mapping: ColumnMapping, field: ImportField): string | null {
  const header = mapping[field];
  if (!header) return null;
  const value = record[header];
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

export function parseImportRow(record: Record<string, string>, mapping: ColumnMapping, options: ImportOptions = {}): RowResult {
  const fail = (error: string): RowResult => ({ ok: false, error });

  const symbolRaw = cell(record, mapping, "symbol");
  if (!symbolRaw) return fail("missing symbol");
  // A symbol that names a contract ("SPY240920C00450000", "SPY 09/20/2024 450 C") becomes an option on the underlying.
  const contract = parseOptionSymbol(symbolRaw);
  const symbol = (contract ? contract.underlying : symbolRaw.toUpperCase()).slice(0, 32);

  const quantityRaw = cell(record, mapping, "quantity");
  if (!quantityRaw) return fail("missing quantity");
  const quantityParsed = parseNumber(quantityRaw);
  if (quantityParsed === null) return fail(`invalid quantity "${quantityRaw}"`);
  let quantity = new Decimal(quantityParsed);

  let side: Side | null = null;
  const sideRaw = cell(record, mapping, "side");
  if (sideRaw) {
    side = parseSide(sideRaw);
    if (!side) return fail(`unrecognised side "${sideRaw}"`);
  }
  if (!side) side = quantity.isNegative() ? "SHORT" : "LONG";
  quantity = quantity.abs();
  if (quantity.isZero()) return fail("quantity must not be zero");

  const entryRaw = cell(record, mapping, "entryPrice");
  if (!entryRaw) return fail("missing entry price");
  const entryPrice = parseNumber(entryRaw);
  if (entryPrice === null) return fail(`invalid entry price "${entryRaw}"`);

  const exitRaw = cell(record, mapping, "exitPrice");
  let exitPrice: string | null = null;
  if (exitRaw) {
    exitPrice = parseNumber(exitRaw);
    if (exitPrice === null) return fail(`invalid exit price "${exitRaw}"`);
  }

  const dateOptions = { dayFirst: options.dayFirst, timeZone: options.timeZone ?? "UTC" };
  const entryAtRaw = cell(record, mapping, "entryAt");
  if (!entryAtRaw) return fail("missing entry time");
  const entryAt = parseFlexibleDate(entryAtRaw, dateOptions);
  if (!entryAt) return fail(`invalid entry time "${entryAtRaw}"`);

  const exitAtRaw = cell(record, mapping, "exitAt");
  let exitAt: Date | null = null;
  if (exitAtRaw) {
    exitAt = parseFlexibleDate(exitAtRaw, dateOptions);
    if (!exitAt) return fail(`invalid exit time "${exitAtRaw}"`);
  }

  const feesRaw = cell(record, mapping, "fees");
  let fees = "0";
  if (feesRaw) {
    const parsed = parseNumber(feesRaw);
    if (parsed === null) return fail(`invalid fees "${feesRaw}"`);
    fees = new Decimal(parsed).abs().toFixed();
  }

  // Option details: from the contract in the symbol, then from explicit columns, which win.
  let optionType: OptionType | null = contract?.optionType ?? null;
  let strikePrice: string | null = contract?.strike ?? null;
  let expiresAt: Date | null = contract ? expirationInstant(contract.expiration) : null;
  const optionTypeRaw = cell(record, mapping, "optionType");
  if (optionTypeRaw) {
    optionType = parseOptionType(optionTypeRaw);
    if (!optionType) return fail(`unrecognised call/put "${optionTypeRaw}"`);
  }
  const strikeRaw = cell(record, mapping, "strikePrice");
  if (strikeRaw) {
    const parsed = parseNumber(strikeRaw);
    if (parsed === null || new Decimal(parsed).lessThanOrEqualTo(0)) return fail(`invalid strike "${strikeRaw}"`);
    strikePrice = parsed;
  }
  const expiresRaw = cell(record, mapping, "expiresAt");
  if (expiresRaw) {
    const parsed = parseFlexibleDate(expiresRaw, { dayFirst: options.dayFirst, timeZone: "UTC" });
    expiresAt = parsed ? expirationInstant(parsed.toISOString().slice(0, 10)) : null;
    if (!expiresAt) return fail(`invalid expiration "${expiresRaw}"`);
  }
  const optionRow = optionType !== null || strikePrice !== null || expiresAt !== null;

  const multiplierRaw = cell(record, mapping, "multiplier");
  let multiplier = options.defaultMultiplier && options.defaultMultiplier.trim() !== "" ? options.defaultMultiplier.trim() : "1";
  if (multiplierRaw) {
    const parsed = parseNumber(multiplierRaw);
    if (parsed === null || new Decimal(parsed).lessThanOrEqualTo(0)) return fail(`invalid multiplier "${multiplierRaw}"`);
    multiplier = parsed;
  } else if (optionRow) {
    // A contract row without a multiplier of its own is a standard 100-share contract.
    multiplier = OPTION_MULTIPLIER;
  }
  if (!/^\d*\.?\d+$/.test(multiplier) || new Decimal(multiplier).lessThanOrEqualTo(0)) return fail("default multiplier must be a positive number");

  let assetClass: AssetClass = optionRow ? "OPTION" : (options.defaultAssetClass ?? "STOCK");
  const assetRaw = cell(record, mapping, "assetClass");
  if (assetRaw) {
    const parsed = parseAssetClass(assetRaw);
    if (parsed) assetClass = parsed;
  }
  if (assetClass !== "OPTION") {
    optionType = null;
    strikePrice = null;
    expiresAt = null;
  }

  const parseOptional = (field: ImportField): string | null | undefined => {
    const raw = cell(record, mapping, field);
    if (!raw) return null;
    const parsed = parseNumber(raw);
    if (parsed === null) return undefined;
    return parsed;
  };
  const stopPrice = parseOptional("stopPrice");
  if (stopPrice === undefined) return fail(`invalid stop price "${cell(record, mapping, "stopPrice")}"`);
  const targetPrice = parseOptional("targetPrice");
  if (targetPrice === undefined) return fail(`invalid target price "${cell(record, mapping, "targetPrice")}"`);

  // Files that only carry a P&L column: derive the exit price so the stored
  // figures stay consistent with the P&L formula.
  const pnlRaw = cell(record, mapping, "pnl");
  if (!exitPrice && pnlRaw) {
    const parsedPnl = parseNumber(pnlRaw);
    if (parsedPnl === null) return fail(`invalid P&L "${pnlRaw}"`);
    const derived = exitPriceForNetPnl({ side, quantity, entryPrice, multiplier, fees }, parsedPnl);
    if (!derived) return fail("cannot derive exit price from P&L");
    exitPrice = derived.toFixed();
  }

  const status = exitPrice !== null ? "CLOSED" : "OPEN";
  if (status === "CLOSED" && !exitAt) exitAt = entryAt;
  if (status === "OPEN") exitAt = null;
  if (exitAt && exitAt.getTime() < entryAt.getTime()) return fail("exit time is before entry time");

  const pnlInput = { side, quantity, entryPrice, exitPrice, multiplier, fees, stopPrice };
  const pnl = netPnl(pnlInput);
  const r = rMultiple(pnlInput);

  return {
    ok: true,
    row: {
      symbol,
      side,
      assetClass,
      quantity: quantity.toFixed(),
      entryPrice,
      exitPrice,
      multiplier,
      fees,
      entryAt,
      exitAt,
      status,
      pnl: pnl ? pnl.toFixed() : null,
      rMultiple: r ? r.toFixed() : null,
      stopPrice,
      targetPrice,
      optionType,
      strikePrice,
      expiresAt,
      notes: cell(record, mapping, "notes") ?? "",
      importHashKey: importHashKey({
        symbol,
        side,
        quantity,
        entryPrice,
        entryAt,
        optionType,
        strikePrice,
        expiration: expiresAt ? expiresAt.toISOString().slice(0, 10) : null,
      }),
    },
  };
}

/** Canonical decimal string for display in previews. */
export function formatDecimalString(value: string | null): string {
  return value === null ? "" : toDecimal(value).toFixed();
}
