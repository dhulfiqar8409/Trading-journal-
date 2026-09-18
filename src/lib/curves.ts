/**
 * Three equity curves from the same trades: what actually happened, the
 * same history with every mistake-tagged trade removed, and the history
 * with every loss capped at the planned stop (1R).
 */
import { Decimal, toDecimalOrNull, ZERO, type DecimalInput } from "@/lib/decimal";

export interface CurveTrade {
  id: string;
  symbol: string;
  status: "OPEN" | "CLOSED";
  exitAt: Date | null;
  pnl: DecimalInput | null;
  rMultiple: DecimalInput | null;
  /** Size of 1R in currency; null without a stop. */
  plannedRisk: DecimalInput | null;
  hasMistake: boolean;
}

export interface CurvePoint {
  t: number;
  tradeId: string;
  symbol: string;
  pnl: Decimal;
  actual: Decimal;
  mistakesRemoved: Decimal;
  stopsHonoured: Decimal;
  /** The same three curves in R; trades without a stop contribute nothing. */
  actualR: Decimal;
  mistakesRemovedR: Decimal;
  stopsHonouredR: Decimal;
  /** True when this trade was dropped from the mistakes-removed curve. */
  removed: boolean;
  /** True when this trade's loss was capped on the stops-honoured curve. */
  capped: boolean;
}

export interface ThreeCurves {
  points: CurvePoint[];
  actual: Decimal;
  mistakesRemoved: Decimal;
  stopsHonoured: Decimal;
  actualR: Decimal;
  mistakesRemovedR: Decimal;
  stopsHonouredR: Decimal;
  removedCount: number;
  cappedCount: number;
}

/** The P&L a trade would have had if it had been closed at the planned stop: never worse than -1R. */
export function cappedPnl(pnl: Decimal, plannedRisk: Decimal | null, rMultiple: Decimal | null): { pnl: Decimal; capped: boolean } {
  if (!plannedRisk || plannedRisk.isZero() || !rMultiple) return { pnl, capped: false };
  if (rMultiple.lessThan(-1)) return { pnl: plannedRisk.neg(), capped: true };
  return { pnl, capped: false };
}

export function threeCurves(trades: CurveTrade[]): ThreeCurves {
  const closed = trades
    .filter((t) => t.status === "CLOSED" && t.exitAt && toDecimalOrNull(t.pnl) !== null)
    .sort((a, b) => (a.exitAt as Date).getTime() - (b.exitAt as Date).getTime() || a.id.localeCompare(b.id));
  let actual = ZERO;
  let mistakesRemoved = ZERO;
  let stopsHonoured = ZERO;
  let actualR = ZERO;
  let mistakesRemovedR = ZERO;
  let stopsHonouredR = ZERO;
  let removedCount = 0;
  let cappedCount = 0;
  const points: CurvePoint[] = [];
  for (const t of closed) {
    const pnl = toDecimalOrNull(t.pnl) as Decimal;
    const r = toDecimalOrNull(t.rMultiple);
    actual = actual.plus(pnl);
    if (r) actualR = actualR.plus(r);
    if (t.hasMistake) removedCount++;
    else {
      mistakesRemoved = mistakesRemoved.plus(pnl);
      if (r) mistakesRemovedR = mistakesRemovedR.plus(r);
    }
    const capped = cappedPnl(pnl, toDecimalOrNull(t.plannedRisk), r);
    if (capped.capped) cappedCount++;
    stopsHonoured = stopsHonoured.plus(capped.pnl);
    if (r) stopsHonouredR = stopsHonouredR.plus(r.lessThan(-1) ? new Decimal(-1) : r);
    points.push({
      t: (t.exitAt as Date).getTime(),
      tradeId: t.id,
      symbol: t.symbol,
      pnl,
      actual,
      mistakesRemoved,
      stopsHonoured,
      actualR,
      mistakesRemovedR,
      stopsHonouredR,
      removed: t.hasMistake,
      capped: capped.capped,
    });
  }
  return { points, actual, mistakesRemoved, stopsHonoured, actualR, mistakesRemovedR, stopsHonouredR, removedCount, cappedCount };
}
