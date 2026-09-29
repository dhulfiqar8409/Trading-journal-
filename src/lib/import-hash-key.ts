import { toDecimal, type DecimalInput } from "@/lib/decimal";
import type { Side } from "@/lib/pnl";

export interface ImportIdentity {
  symbol: string;
  side: Side;
  quantity: DecimalInput;
  entryPrice: DecimalInput;
  entryAt: Date;
  /** Option contracts on one underlying are distinct trades; absent for everything else so older hashes still match. */
  optionType?: "CALL" | "PUT" | null;
  strikePrice?: DecimalInput | null;
  /** "YYYY-MM-DD" */
  expiration?: string | null;
  /**
   * Execution imports only: the parts of a split position share every entry
   * detail, so the closed part is told apart by its exit (the open remainder
   * has none). Trade-row imports leave it out so older hashes still match.
   */
  exitAt?: Date | null;
  /**
   * Execution imports from an order list: the broker's order numbers behind
   * the trade, so the same export re-imported adds nothing while an order
   * edited and re-placed at the same price and minute does not collide.
   */
  orderIds?: readonly string[] | null;
}

/** Canonical string identifying a trade for de-duplication (safe to compute in the browser). */
export function importHashKey(identity: ImportIdentity): string {
  const parts = [
    identity.symbol.trim().toUpperCase(),
    identity.side,
    toDecimal(identity.quantity).toFixed(),
    toDecimal(identity.entryPrice).toFixed(),
    identity.entryAt.toISOString(),
  ];
  if (identity.optionType && identity.strikePrice !== null && identity.strikePrice !== undefined && identity.expiration) {
    parts.push(identity.optionType, toDecimal(identity.strikePrice).toFixed(), identity.expiration);
  }
  if (identity.exitAt) parts.push(`exit:${identity.exitAt.toISOString()}`);
  if (identity.orderIds && identity.orderIds.length) parts.push(`orders:${[...new Set(identity.orderIds.map((id) => id.trim()))].sort().join(",")}`);
  return parts.join("|");
}
