/**
 * Executions matched into round-trip trades. Brokers such as thinkorswim
 * export one row per fill (BUY +100 TO OPEN, SELL -100 TO CLOSE), not one per
 * trade, and the Schwab website lists "Buy to Open" / "Sell to Close" rows
 * next to dividends, transfers and expirations. This module reads those rows
 * and pairs them per contract, in time order, into the trades the journal
 * stores: opens build a position with a quantity-weighted entry, closes take
 * from it and become closed trades, whatever is left stays open. Pure and
 * browser-safe: the preview runs it in the browser, the import route on the
 * server.
 */
import { planClose } from "@/lib/close";
import {
  guessMappingFor,
  nonTradeAction,
  parseAction,
  parseAssetClass,
  parseNumber,
  parseOptionType,
  type ActionSide,
  type AssetClass,
  type ImportOptions,
  type ParsedImportRow,
  type PositionEffect,
} from "@/lib/csv";
import { hasTimeOfDay, parseFlexibleDate } from "@/lib/dates";
import { Decimal, toDecimal, ZERO } from "@/lib/decimal";
import { importHashKey } from "@/lib/import-hash-key";
import { expirationInstant, formatStrike, OPTION_MULTIPLIER, parseOptionSymbol, tradeLabel, type OptionType } from "@/lib/options";
import { netPnl, type Side } from "@/lib/pnl";

export type { PositionEffect };
export type FillSide = ActionSide;

export const EXECUTION_FIELDS = ["symbol", "side", "quantity", "posEffect", "price", "time", "fees", "expiresAt", "strikePrice", "optionType", "spread"] as const;
export type ExecutionField = (typeof EXECUTION_FIELDS)[number];
export type ExecutionMapping = Partial<Record<ExecutionField, string>>;

export const EXECUTION_FIELD_INFO: Record<ExecutionField, { label: string; required: boolean; hint: string }> = {
  symbol: { label: "Symbol", required: true, hint: "Underlying or contract, e.g. AAPL, SPY240920C00450000 or TSLA 09/25/2026 357.50 P" },
  side: { label: "Side", required: false, hint: "BUY or SELL, or a phrase such as Sell to Close, BTO or Expired; a signed quantity can stand in for it" },
  quantity: { label: "Quantity", required: true, hint: "Shares or contracts of the fill; +100 buys and -100 sells when there is no side column" },
  posEffect: { label: "Position effect", required: false, hint: "TO OPEN or TO CLOSE; read from the side phrase or the running position when absent" },
  price: { label: "Price", required: true, hint: "Fill price" },
  time: { label: "Time", required: true, hint: "Execution date and time, e.g. 9/17/26 09:31:05, or a date such as 09/17/2026" },
  fees: { label: "Fees", required: false, hint: "Commission and fees of the fill, summed into the trade" },
  expiresAt: { label: "Expiration", required: false, hint: "Options: expiration date, e.g. 20 SEP 26" },
  strikePrice: { label: "Strike", required: false, hint: "Options: strike price" },
  optionType: { label: "Type", required: false, hint: "CALL or PUT; STOCK or FUTURE name the instrument for everything else" },
  spread: { label: "Spread", required: false, hint: "Multi-leg strategy (VERTICAL, CALENDAR, ...), noted on each leg" },
};

const EXECUTION_SYNONYMS: Record<ExecutionField, string[]> = {
  symbol: ["symbol", "ticker", "underlying", "instrument", "contract", "security", "sym", "product"],
  side: ["side", "action", "buysell", "bs", "direction", "transaction", "orderside", "buyorsell", "transactiontype"],
  quantity: ["qty", "quantity", "shares", "contracts", "size", "filledqty", "execqty", "units", "filled", "amount"],
  posEffect: ["poseffect", "positioneffect", "openclose", "effect", "opencloseindicator", "opcl", "positioneffectopenclose"],
  price: ["price", "execprice", "fillprice", "avgprice", "averageprice", "tradeprice", "executionprice", "fill"],
  time: ["exectime", "executiontime", "time", "datetime", "timestamp", "filltime", "date", "tradedate", "execdate", "executeddate", "transactiondate"],
  fees: ["fees", "fee", "commission", "commissions", "commissionsandfees", "feesandcomm", "feescomm", "feesandcommissions", "commfee", "totalfees", "charges"],
  expiresAt: ["exp", "expiration", "expirationdate", "expiry", "expdate", "expires", "expirydate"],
  strikePrice: ["strike", "strikeprice", "strk"],
  optionType: ["type", "putcall", "callput", "optiontype", "right", "cp", "instrumenttype", "assettype"],
  spread: ["spread", "strategy", "spreadtype"],
};

export function guessExecutionMapping(headers: string[]): ExecutionMapping {
  return guessMappingFor(headers, EXECUTION_FIELDS, EXECUTION_SYNONYMS);
}

/** A broker event that ends a contract without a fill of its own. */
export type FillEvent = "EXPIRED" | "ASSIGNED" | "EXERCISED";

export interface Fill {
  /** Row number in the file (the header is line 1). */
  row: number;
  symbol: string;
  assetClass: AssetClass;
  side: FillSide;
  /** Positive. */
  quantity: string;
  posEffect: PositionEffect | null;
  price: string;
  time: Date;
  /** False when the source gave a date with no clock time, as a Schwab transaction history does. */
  timeOfDay: boolean;
  /** Zero or more. */
  fees: string;
  multiplier: string;
  optionType: OptionType | null;
  strikePrice: string | null;
  expiresAt: Date | null;
  /** Multi-leg strategy name; null for single contracts and shares. */
  spread: string | null;
  /** An expiration, assignment or exercise: it closes whichever side of the contract is open, at 0. */
  event: FillEvent | null;
}

export type FillResult =
  | { ok: true; fill: Fill }
  | { ok: false; skipped?: false; error: string }
  /** A row that is not a fill (a dividend, a transfer, interest): left out with its action as the reason, not an error. */
  | { ok: false; skipped: true; reason: string };

/** OPEN or CLOSE from a position-effect cell; null when the cell is empty, undefined when it says something else. */
export function parsePositionEffect(raw: string): PositionEffect | null | undefined {
  const v = raw.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (v === "") return null;
  if (["toopen", "open", "o", "opening", "bto", "sto", "openingtransaction"].includes(v)) return "OPEN";
  if (["toclose", "close", "c", "closing", "btc", "stc", "closingtransaction", "cover"].includes(v)) return "CLOSE";
  return undefined;
}

/** The contract event a side or action cell names: Expired, Assigned, Exchange or Exercise. Null for anything else. */
export function parseFillEvent(raw: string): FillEvent | null {
  const v = raw.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (["expired", "expire", "expiration", "expiry", "expiredworthless", "optionexpiration"].includes(v)) return "EXPIRED";
  if (["assigned", "assignment", "optionassignment"].includes(v)) return "ASSIGNED";
  if (["exchangeorexercise", "exerciseorexchange", "exercise", "exercised", "optionexercise"].includes(v)) return "EXERCISED";
  return null;
}

function cell(record: Record<string, string>, mapping: ExecutionMapping, field: ExecutionField): string | null {
  const header = mapping[field];
  if (!header) return null;
  const value = record[header];
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

/** One execution row into a fill. `rowNumber` is the line in the file, for messages and notes. */
export function parseFillRow(record: Record<string, string>, mapping: ExecutionMapping, options: ImportOptions = {}, rowNumber = 0): FillResult {
  const fail = (error: string): FillResult => ({ ok: false, error });

  // The side comes first: a Schwab history lists dividends and transfers next
  // to fills, with no symbol or quantity, and those rows are skipped, not errors.
  let side: FillSide | null = null;
  let effectFromSide: PositionEffect | null = null;
  let event: FillEvent | null = null;
  const sideRaw = cell(record, mapping, "side");
  if (sideRaw) {
    const action = parseAction(sideRaw);
    if (action) {
      side = action.side;
      effectFromSide = action.effect;
    } else {
      event = parseFillEvent(sideRaw);
      if (!event) {
        const nonTrade = nonTradeAction(sideRaw);
        if (nonTrade) return { ok: false, skipped: true, reason: nonTrade };
        return fail(`unrecognised side "${sideRaw}"`);
      }
    }
  }

  const symbolRaw = cell(record, mapping, "symbol");
  if (!symbolRaw) return fail("missing symbol");
  let symbol = symbolRaw.toUpperCase();
  let assetClass: AssetClass = options.defaultAssetClass ?? "STOCK";
  if (symbol.startsWith("/")) {
    symbol = symbol.slice(1);
    assetClass = "FUTURES";
  }
  const contract = parseOptionSymbol(symbol);
  if (contract) symbol = contract.underlying;
  symbol = symbol.slice(0, 32);
  let optionType: OptionType | null = contract?.optionType ?? null;
  let strikePrice: string | null = contract?.strike ?? null;
  let expiresAt: Date | null = contract ? expirationInstant(contract.expiration) : null;

  // "Type" says CALL or PUT for options and names the instrument for everything else.
  const typeRaw = cell(record, mapping, "optionType");
  if (typeRaw) {
    const type = parseOptionType(typeRaw);
    if (type) optionType = type;
    else {
      const cls = parseAssetClass(typeRaw);
      if (cls) assetClass = cls;
    }
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
  if (optionType !== null || (strikePrice !== null && expiresAt !== null)) assetClass = "OPTION";
  if (assetClass !== "OPTION") {
    optionType = null;
    strikePrice = null;
    expiresAt = null;
  }

  const quantityRaw = cell(record, mapping, "quantity");
  if (!quantityRaw) return fail("missing quantity");
  const quantityParsed = parseNumber(quantityRaw);
  if (quantityParsed === null) return fail(`invalid quantity "${quantityRaw}"`);
  const signed = new Decimal(quantityParsed);
  if (signed.isZero()) return fail("quantity must not be zero");

  if (event) {
    // Whichever side is open gets closed; the matcher settles the direction against the position.
    side = "SELL";
  } else if (!side && (signed.isNegative() || quantityRaw.trim().startsWith("+"))) {
    side = signed.isNegative() ? "SELL" : "BUY";
  }
  if (!side) return fail("missing side");

  let posEffect: PositionEffect | null = event ? "CLOSE" : effectFromSide;
  const effectRaw = event ? null : cell(record, mapping, "posEffect");
  if (effectRaw) {
    const parsed = parsePositionEffect(effectRaw);
    if (parsed === undefined) return fail(`unrecognised position effect "${effectRaw}"`);
    if (parsed) posEffect = parsed;
  }

  // An expiration, assignment or exercise closes the contract at 0; the strike is noted on the trade instead.
  let price = "0";
  if (!event) {
    const priceRaw = cell(record, mapping, "price");
    if (!priceRaw) return fail("missing price");
    const parsed = parseNumber(priceRaw);
    if (parsed === null || new Decimal(parsed).isNegative()) return fail(`invalid price "${priceRaw}"`);
    price = parsed;
  }

  const timeRaw = cell(record, mapping, "time");
  if (!timeRaw) return fail("missing time");
  const time = parseFlexibleDate(timeRaw, { dayFirst: options.dayFirst, timeZone: options.timeZone ?? "UTC" });
  if (!time) return fail(`invalid time "${timeRaw}"`);

  let fees = "0";
  const feesRaw = cell(record, mapping, "fees");
  if (feesRaw) {
    const parsed = parseNumber(feesRaw);
    if (parsed === null) return fail(`invalid fees "${feesRaw}"`);
    fees = new Decimal(parsed).abs().toFixed();
  }

  let multiplier = assetClass === "OPTION" ? OPTION_MULTIPLIER : (options.defaultMultiplier?.trim() || "1");
  if (!/^\d*\.?\d+$/.test(multiplier) || new Decimal(multiplier).lessThanOrEqualTo(0)) return fail("default multiplier must be a positive number");
  multiplier = new Decimal(multiplier).toFixed();

  const spreadRaw = cell(record, mapping, "spread")?.toUpperCase() ?? null;
  const spread = spreadRaw && spreadRaw !== "STOCK" && spreadRaw !== "SINGLE" && spreadRaw !== "FUTURE" ? spreadRaw : null;

  return {
    ok: true,
    fill: {
      row: rowNumber,
      symbol,
      assetClass,
      side,
      quantity: signed.abs().toFixed(),
      posEffect,
      price,
      time,
      timeOfDay: hasTimeOfDay(timeRaw),
      fees,
      multiplier,
      optionType,
      strikePrice,
      expiresAt,
      spread,
      event,
    },
  };
}

export interface MatchedTrade extends ParsedImportRow {
  kind: "closed" | "open" | "unmatched";
  /** Rows of the file that fed this trade. */
  fillRows: number[];
  label: string;
}

export interface UnmatchedClose {
  row: number;
  label: string;
  side: FillSide;
  quantity: string;
  time: Date;
  reason: string;
  /** The trade to store when the owner opts in: closed, with the entry copied from the exit and marked unknown. */
  trade: MatchedTrade;
}

/** How fills that share a time are ordered: by row top to bottom, or bottom up for a dated-only file listed newest first. */
export type FillOrder = "as-listed" | "newest-first";

export interface MatchResult {
  trades: MatchedTrade[];
  unmatched: UnmatchedClose[];
  warnings: string[];
  fillCount: number;
  order: FillOrder;
}

export interface MatchOptions {
  /** Close fills of one position this close together are one exit (an order filled in pieces); further apart they are separate partial closes. */
  mergeWindowSeconds?: number;
  /** Row order for fills that share a time; read from the file when absent. */
  order?: FillOrder;
}

export const DEFAULT_MERGE_WINDOW_SECONDS = 120;

/**
 * A file whose dates carry no clock time and run newest first (a Schwab
 * transaction history) is read bottom up, so a same-day open comes before
 * its close. Files with times, ascending dates or a mixed order keep their
 * row order.
 */
export function fillOrder(fills: Fill[]): FillOrder {
  if (fills.length < 2 || fills.some((f) => f.timeOfDay)) return "as-listed";
  const byRow = [...fills].sort((a, b) => a.row - b.row);
  let descends = false;
  for (let i = 1; i < byRow.length; i++) {
    const delta = byRow[i].time.getTime() - byRow[i - 1].time.getTime();
    if (delta > 0) return "as-listed";
    if (delta < 0) descends = true;
  }
  return descends ? "newest-first" : "as-listed";
}

interface ClosingBatch {
  quantity: Decimal;
  /** Sum of price x quantity, for the weighted average exit. */
  value: Decimal;
  fees: Decimal;
  exitAt: Date;
  rows: number[];
  /** The position's quantity and fees when the batch began, for the fee split. */
  openQuantity: Decimal;
  openFees: Decimal;
  /** Set when the contract was ended by an expiration, assignment or exercise rather than a fill. */
  event: FillEvent | null;
}

interface Position {
  template: Fill;
  side: Side;
  quantity: Decimal;
  avgEntry: Decimal;
  entryAt: Date;
  fees: Decimal;
  rows: number[];
  spreads: Set<string>;
  batch: ClosingBatch | null;
}

function contractKey(f: Fill): string {
  return [f.symbol, f.assetClass, f.optionType ?? "", f.strikePrice ?? "", f.expiresAt ? f.expiresAt.toISOString() : ""].join("|");
}

function directionOf(side: FillSide): Side {
  return side === "BUY" ? "LONG" : "SHORT";
}

function labelOf(f: Fill): string {
  return tradeLabel({ symbol: f.symbol, assetClass: f.assetClass, optionType: f.optionType, strikePrice: f.strikePrice, expiresAt: f.expiresAt });
}

function rowsText(rows: number[]): string {
  const shown = rows.slice(0, 20).join(", ");
  return rows.length > 20 ? `${shown} and ${rows.length - 20} more` : shown;
}

/** What an expiration, assignment or exercise did to the trade, for its notes. */
function eventNote(event: FillEvent | null, f: Fill): string | undefined {
  if (!event) return undefined;
  if (event === "EXPIRED") return "Expired worthless: the broker's Expired row closes the contract at 0.";
  const strike = f.strikePrice ? ` at the ${formatStrike(f.strikePrice)} strike` : "";
  return `${event === "ASSIGNED" ? "Assigned" : "Exercised"}${strike}: the contract was settled by delivery, so it is closed at 0 and the premium is its whole result; the shares that changed hands at the strike appear as their own stock trade.`;
}

interface TradeSpec {
  template: Fill;
  side: Side;
  quantity: Decimal;
  entryPrice: Decimal;
  exitPrice: Decimal | null;
  entryAt: Date;
  exitAt: Date | null;
  fees: Decimal;
  rows: number[];
  spreads: Set<string>;
  kind: MatchedTrade["kind"];
  extraNote?: string;
}

function makeTrade(t: TradeSpec): MatchedTrade {
  const f = t.template;
  const quantity = t.quantity.toDecimalPlaces(8).toFixed();
  const entryPrice = t.entryPrice.toDecimalPlaces(8).toFixed();
  const exitPrice = t.exitPrice ? t.exitPrice.toDecimalPlaces(8).toFixed() : null;
  const fees = t.fees.toDecimalPlaces(8).toFixed();
  const pnl = exitPrice === null ? null : netPnl({ side: t.side, quantity, entryPrice, exitPrice, multiplier: f.multiplier, fees });
  const rows = [...new Set(t.rows)].sort((a, b) => a - b);
  const notes = [
    `Imported from ${rows.length} fill${rows.length === 1 ? "" : "s"} (row${rows.length === 1 ? "" : "s"} ${rowsText(rows)}).`,
    t.spreads.size ? `Leg of a ${[...t.spreads].join(" / ")} spread; each leg is its own trade.` : "",
    t.extraNote ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    symbol: f.symbol,
    side: t.side,
    assetClass: f.assetClass,
    quantity,
    entryPrice,
    exitPrice,
    multiplier: f.multiplier,
    fees,
    entryAt: t.entryAt,
    exitAt: t.exitAt,
    status: exitPrice === null ? "OPEN" : "CLOSED",
    pnl: pnl ? pnl.toFixed() : null,
    rMultiple: null,
    stopPrice: null,
    targetPrice: null,
    optionType: f.optionType,
    strikePrice: f.strikePrice,
    expiresAt: f.expiresAt,
    notes,
    importHashKey: importHashKey({
      symbol: f.symbol,
      side: t.side,
      quantity,
      entryPrice,
      entryAt: t.entryAt,
      optionType: f.optionType,
      strikePrice: f.strikePrice,
      expiration: f.expiresAt ? f.expiresAt.toISOString().slice(0, 10) : null,
      exitAt: t.exitAt,
    }),
    kind: t.kind,
    fillRows: rows,
    label: labelOf(f),
  };
}

function unmatchedOf(f: Fill, quantity: Decimal, fees: Decimal): UnmatchedClose {
  const label = labelOf(f);
  const side = f.side === "SELL" ? "LONG" : "SHORT";
  const price = toDecimal(f.price);
  const what =
    f.event === "EXPIRED" ? "it expired" : f.event === "ASSIGNED" ? "it was assigned" : f.event === "EXERCISED" ? "it was exercised" : `this ${f.side} of ${quantity.toFixed()}`;
  const trade = makeTrade({
    template: f,
    side,
    quantity,
    entryPrice: price,
    exitPrice: price,
    entryAt: f.time,
    exitAt: f.time,
    fees,
    rows: [f.row],
    spreads: new Set(f.spread ? [f.spread] : []),
    kind: "unmatched",
    extraNote: [
      "Entry unknown: this closing fill has no matching open in the file, so the position was opened before the statement window. Entry price and time are copied from the exit and the result is the fees only; edit the trade once the real entry is known.",
      eventNote(f.event, f) ?? "",
    ]
      .filter(Boolean)
      .join(" "),
  });
  return {
    row: f.row,
    label,
    side: f.side,
    quantity: quantity.toFixed(),
    time: f.time,
    reason: `No open ${label} position in this file before ${what}: it was opened before the statement window. Export a wider date range, or import it as a closed trade with an unknown entry.`,
    trade,
  };
}

/**
 * Pairs fills into trades per contract (symbol, expiration, strike, type)
 * in time order. Opens accumulate a position with a quantity-weighted entry;
 * closes reduce it and become a closed trade (weighted average exit, entry
 * from the first open, exit from the last close fill of the burst, fees
 * summed and the entry fees split like a partial close). A close without an
 * open is reported as unmatched. When a fill carries no position effect it
 * is read from the running position: a sell while long closes, a sell while
 * flat opens short. An expiration, assignment or exercise closes whichever
 * side is open at 0.
 */
export function matchFills(input: Fill[], options: MatchOptions = {}): MatchResult {
  const windowMs = (options.mergeWindowSeconds ?? DEFAULT_MERGE_WINDOW_SECONDS) * 1000;
  const order = options.order ?? fillOrder(input);
  const rowDirection = order === "newest-first" ? -1 : 1;
  const fills = [...input].sort((a, b) => a.time.getTime() - b.time.getTime() || (a.row - b.row) * rowDirection);
  const positions = new Map<string, Position>();
  const trades: MatchedTrade[] = [];
  const unmatched: UnmatchedClose[] = [];
  const warnings: string[] = [];

  const flush = (p: Position) => {
    const b = p.batch;
    if (!b) return;
    p.batch = null;
    const plan = planClose({ quantity: b.openQuantity, fees: b.openFees }, { closeQuantity: b.quantity, extraFees: b.fees });
    if (!plan.ok) {
      warnings.push(`${labelOf(p.template)}: could not split the fees (${plan.error}).`);
      return;
    }
    p.fees = plan.plan.kind === "partial" ? toDecimal(plan.plan.remaining.fees) : ZERO;
    trades.push(
      makeTrade({
        template: p.template,
        side: p.side,
        quantity: b.quantity,
        entryPrice: p.avgEntry,
        exitPrice: b.value.div(b.quantity),
        entryAt: p.entryAt,
        exitAt: b.exitAt,
        fees: toDecimal(plan.plan.closed.fees),
        rows: [...p.rows, ...b.rows],
        spreads: p.spreads,
        kind: "closed",
        extraNote: eventNote(b.event, p.template),
      }),
    );
  };

  const open = (key: string, f: Fill, quantity: Decimal, fees: Decimal) => {
    const existing = positions.get(key);
    if (existing) {
      flush(existing);
      const total = existing.quantity.plus(quantity);
      existing.avgEntry = existing.avgEntry.times(existing.quantity).plus(toDecimal(f.price).times(quantity)).div(total);
      existing.quantity = total;
      existing.fees = existing.fees.plus(fees);
      existing.rows.push(f.row);
      if (f.spread) existing.spreads.add(f.spread);
      return;
    }
    positions.set(key, {
      template: f,
      side: directionOf(f.side),
      quantity,
      avgEntry: toDecimal(f.price),
      entryAt: f.time,
      fees,
      rows: [f.row],
      spreads: new Set(f.spread ? [f.spread] : []),
      batch: null,
    });
  };

  for (const f of fills) {
    const key = contractKey(f);
    const position = positions.get(key);
    const quantity = toDecimal(f.quantity);
    const fees = toDecimal(f.fees);
    // An expiration, assignment or exercise closes whichever side is open.
    const side: FillSide = f.event && position ? (position.side === "LONG" ? "SELL" : "BUY") : f.side;
    let effect: PositionEffect = f.posEffect ?? (position ? (directionOf(side) === position.side ? "OPEN" : "CLOSE") : "OPEN");
    if (effect === "OPEN" && position && directionOf(side) !== position.side) {
      warnings.push(`Row ${f.row}: ${labelOf(f)} ${side} is marked to open while the position is ${position.side.toLowerCase()}; treated as a close.`);
      effect = "CLOSE";
    }
    if (effect === "OPEN") {
      open(key, f, quantity, fees);
      continue;
    }
    if (!position) {
      unmatched.push(unmatchedOf(f, quantity, fees));
      continue;
    }
    if (position.batch && f.time.getTime() - position.batch.exitAt.getTime() > windowMs) flush(position);
    const closeQuantity = Decimal.min(quantity, position.quantity);
    const excess = quantity.minus(closeQuantity);
    const closeFees = fees.times(closeQuantity).div(quantity);
    if (!position.batch) {
      position.batch = { quantity: ZERO, value: ZERO, fees: ZERO, exitAt: f.time, rows: [], openQuantity: position.quantity, openFees: position.fees, event: null };
    }
    position.batch.quantity = position.batch.quantity.plus(closeQuantity);
    position.batch.value = position.batch.value.plus(toDecimal(f.price).times(closeQuantity));
    position.batch.fees = position.batch.fees.plus(closeFees);
    position.batch.exitAt = f.time;
    position.batch.rows.push(f.row);
    if (f.event) position.batch.event = f.event;
    position.quantity = position.quantity.minus(closeQuantity);
    if (position.quantity.isZero()) {
      flush(position);
      positions.delete(key);
    }
    if (excess.greaterThan(0)) {
      const rest = fees.minus(closeFees);
      if (f.posEffect === "CLOSE") {
        unmatched.push(unmatchedOf(f, excess, rest));
      } else {
        warnings.push(`Row ${f.row}: ${labelOf(f)} ${side} ${quantity.toFixed()} closed ${closeQuantity.toFixed()} and opened ${excess.toFixed()} the other way.`);
        open(key, f, excess, rest);
      }
    }
  }

  for (const position of positions.values()) {
    flush(position);
    if (!position.quantity.greaterThan(0)) continue;
    trades.push(
      makeTrade({
        template: position.template,
        side: position.side,
        quantity: position.quantity,
        entryPrice: position.avgEntry,
        exitPrice: null,
        entryAt: position.entryAt,
        exitAt: null,
        fees: position.fees,
        rows: position.rows,
        spreads: position.spreads,
        kind: "open",
      }),
    );
  }
  trades.sort((a, b) => a.entryAt.getTime() - b.entryAt.getTime() || a.fillRows[0] - b.fillRows[0]);
  return { trades, unmatched, warnings, fillCount: fills.length, order };
}
