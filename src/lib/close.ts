/**
 * Closing an open trade, in part or in full: how the quantity and the entry
 * fees split between the part that closes and the remainder, and the notes
 * that record it on both. Pure: the action applies the plan in one
 * transaction.
 */
import { Decimal, toDecimal, toDecimalOrNull, ZERO, type DecimalInput } from "@/lib/decimal";

export interface OpenPosition {
  quantity: DecimalInput;
  /** Fees carried by the open trade so far (entry side). */
  fees: DecimalInput;
}

export interface CloseRequest {
  closeQuantity: DecimalInput;
  /** Fees of the closing fill, added on top of the entry fees. */
  extraFees?: DecimalInput | null;
}

export interface ClosedPart {
  quantity: string;
  fees: string;
}

export type ClosePlan =
  | { kind: "full"; closed: ClosedPart }
  | { kind: "partial"; closed: ClosedPart; remaining: ClosedPart };

export type ClosePlanResult = { ok: true; plan: ClosePlan } | { ok: false; error: string; field: "closeQuantity" | "extraFees" };

/**
 * Splits the position. A partial close takes its share of the entry fees in
 * proportion to the quantity closed (plus the closing fees); the remainder
 * keeps the rest, so the two rows add up to what one row would have carried.
 */
export function planClose(position: OpenPosition, request: CloseRequest): ClosePlanResult {
  const open = toDecimal(position.quantity);
  const closing = toDecimal(request.closeQuantity);
  const extra = toDecimalOrNull(request.extraFees) ?? ZERO;
  if (!open.greaterThan(0)) return { ok: false, error: "There is nothing left to close.", field: "closeQuantity" };
  if (!closing.greaterThan(0)) return { ok: false, error: "Close at least a fraction of the position.", field: "closeQuantity" };
  if (closing.greaterThan(open)) return { ok: false, error: `Only ${open.toFixed()} is open.`, field: "closeQuantity" };
  if (extra.lessThan(0)) return { ok: false, error: "Fees cannot be negative.", field: "extraFees" };
  const entryFees = toDecimal(position.fees);
  if (closing.equals(open)) {
    return { ok: true, plan: { kind: "full", closed: { quantity: open.toFixed(), fees: entryFees.plus(extra).toFixed() } } };
  }
  const share = entryFees.times(closing).div(open).toDecimalPlaces(8, Decimal.ROUND_HALF_EVEN);
  return {
    ok: true,
    plan: {
      kind: "partial",
      closed: { quantity: closing.toFixed(), fees: share.plus(extra).toFixed() },
      remaining: { quantity: open.minus(closing).toFixed(), fees: entryFees.minus(share).toFixed() },
    },
  };
}

function joinNotes(...parts: (string | null | undefined)[]): string {
  return parts.map((p) => (p ?? "").trim()).filter(Boolean).join("\n\n");
}

/** Notes of the closed part of a split: the original notes, the reference back, and the exit note. */
export function partialCloseNotes(input: { notes: string; label: string; originalId: string; closed: DecimalInput; total: DecimalInput; exitNote?: string | null }): string {
  return joinNotes(
    input.notes,
    `Partial close of ${input.label} (${input.originalId}): closed ${toDecimal(input.closed).toFixed()} of ${toDecimal(input.total).toFixed()}.`,
    input.exitNote,
  );
}

/** Notes of the remainder after a split. */
export function remainderNotes(input: { notes: string; closed: DecimalInput; total: DecimalInput; remaining: DecimalInput }): string {
  return joinNotes(input.notes, `Closed ${toDecimal(input.closed).toFixed()} of ${toDecimal(input.total).toFixed()}; ${toDecimal(input.remaining).toFixed()} still open.`);
}

/** Notes after a full close: the exit note, when one was written. */
export function fullCloseNotes(notes: string, exitNote?: string | null): string {
  return joinNotes(notes, exitNote);
}
