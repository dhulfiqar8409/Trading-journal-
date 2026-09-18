import { Decimal, toDecimal, toDecimalOrNull, type DecimalInput } from "@/lib/decimal";

export type Side = "LONG" | "SHORT";
export type TradeStatus = "OPEN" | "CLOSED";

export interface PnlInput {
  side: Side;
  quantity: DecimalInput;
  entryPrice: DecimalInput;
  exitPrice?: DecimalInput | null;
  /** Point value (futures) or contract size (options). Defaults to 1. */
  multiplier?: DecimalInput | null;
  /** Total fees and commissions for the round trip. Defaults to 0. */
  fees?: DecimalInput | null;
  stopPrice?: DecimalInput | null;
  targetPrice?: DecimalInput | null;
}

export interface TradeMetrics {
  status: TradeStatus;
  /** (exit - entry) x qty x multiplier x direction, before fees. Null while open. */
  grossPnl: Decimal | null;
  /** Gross P&L minus fees. Null while open. */
  pnl: Decimal | null;
  /** Money at risk between entry and stop. Null without a stop. */
  risk: Decimal | null;
  /** pnl / risk. Null while open, without a stop, or when the stop equals the entry. */
  rMultiple: Decimal | null;
  /** Planned reward-to-risk from the target. Null without both a stop and a target. */
  plannedRewardRisk: Decimal | null;
}

export function directionSign(side: Side): 1 | -1 {
  return side === "LONG" ? 1 : -1;
}

function multiplierOf(input: PnlInput): Decimal {
  return toDecimalOrNull(input.multiplier) ?? new Decimal(1);
}

function feesOf(input: PnlInput): Decimal {
  return toDecimalOrNull(input.fees) ?? new Decimal(0);
}

/** Gross P&L before fees, or null when the trade has no exit price. */
export function grossPnl(input: PnlInput): Decimal | null {
  const exit = toDecimalOrNull(input.exitPrice);
  if (!exit) return null;
  const entry = toDecimal(input.entryPrice);
  const qty = toDecimal(input.quantity);
  return exit.minus(entry).times(qty).times(multiplierOf(input)).times(directionSign(input.side));
}

/** Net P&L: gross P&L minus fees, or null when the trade has no exit price. */
export function netPnl(input: PnlInput): Decimal | null {
  const gross = grossPnl(input);
  if (!gross) return null;
  return gross.minus(feesOf(input));
}

/** Amount risked between entry and stop: |entry - stop| x qty x multiplier. Null without a stop. */
export function riskAmount(input: PnlInput): Decimal | null {
  const stop = toDecimalOrNull(input.stopPrice);
  if (!stop) return null;
  const entry = toDecimal(input.entryPrice);
  return entry.minus(stop).abs().times(toDecimal(input.quantity)).times(multiplierOf(input));
}

/** R-multiple: net P&L divided by the amount risked. */
export function rMultiple(input: PnlInput): Decimal | null {
  const pnl = netPnl(input);
  const risk = riskAmount(input);
  if (!pnl || !risk || risk.isZero()) return null;
  return pnl.div(risk);
}

/** Planned reward-to-risk ratio from stop and target prices. */
export function plannedRewardRisk(input: PnlInput): Decimal | null {
  const stop = toDecimalOrNull(input.stopPrice);
  const target = toDecimalOrNull(input.targetPrice);
  if (!stop || !target) return null;
  const entry = toDecimal(input.entryPrice);
  const risk = entry.minus(stop).abs();
  if (risk.isZero()) return null;
  return target.minus(entry).abs().div(risk);
}

/** Derive the exit price that produces a given net P&L (used when imports carry P&L but no exit price). */
export function exitPriceForNetPnl(input: Omit<PnlInput, "exitPrice">, pnl: DecimalInput): Decimal | null {
  const qty = toDecimal(input.quantity);
  const denominator = qty.times(multiplierOf(input));
  if (denominator.isZero()) return null;
  const gross = toDecimal(pnl).plus(feesOf(input));
  return toDecimal(input.entryPrice).plus(gross.div(denominator).times(directionSign(input.side)));
}

export function computeTradeMetrics(input: PnlInput): TradeMetrics {
  const gross = grossPnl(input);
  const pnl = netPnl(input);
  return {
    status: pnl ? "CLOSED" : "OPEN",
    grossPnl: gross,
    pnl,
    risk: riskAmount(input),
    rMultiple: rMultiple(input),
    plannedRewardRisk: plannedRewardRisk(input),
  };
}
