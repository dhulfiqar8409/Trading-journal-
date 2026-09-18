import type { TradeDTO } from "@/lib/serialize";

/** What the close sheet needs to know about an open trade; built on the server, rendered by the client sheet. */
export interface CloseTarget {
  id: string;
  label: string;
  side: "LONG" | "SHORT";
  quantity: string;
  entryPrice: string;
  entryAt: string;
  multiplier: string;
  fees: string;
  stopPrice: string | null;
  currency: string;
  assetClass: string;
  expiresAt: string | null;
}

export function closeTarget(t: TradeDTO, label: string): CloseTarget {
  return {
    id: t.id,
    label,
    side: t.side,
    quantity: t.quantity,
    entryPrice: t.entryPrice,
    entryAt: t.entryAt,
    multiplier: t.multiplier,
    fees: t.fees,
    stopPrice: t.stopPrice,
    currency: t.currency,
    assetClass: t.assetClass,
    expiresAt: t.expiresAt,
  };
}
