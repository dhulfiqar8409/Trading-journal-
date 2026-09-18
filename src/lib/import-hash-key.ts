import { toDecimal, type DecimalInput } from "@/lib/decimal";
import type { Side } from "@/lib/pnl";

export interface ImportIdentity {
  symbol: string;
  side: Side;
  quantity: DecimalInput;
  entryPrice: DecimalInput;
  entryAt: Date;
}

/** Canonical string identifying a trade for de-duplication (safe to compute in the browser). */
export function importHashKey(identity: ImportIdentity): string {
  return [
    identity.symbol.trim().toUpperCase(),
    identity.side,
    toDecimal(identity.quantity).toFixed(),
    toDecimal(identity.entryPrice).toFixed(),
    identity.entryAt.toISOString(),
  ].join("|");
}
