/** Cost of each MISTAKE tag: the P&L of the trades that carry it. */
import { Decimal, toDecimalOrNull, ZERO, type DecimalInput } from "@/lib/decimal";

export interface MistakeTrade {
  id: string;
  status: "OPEN" | "CLOSED";
  pnl: DecimalInput | null;
  rMultiple: DecimalInput | null;
  tags: { id: string; name: string; kind: string }[];
}

export interface MistakeCost {
  tagId: string;
  name: string;
  count: number;
  netPnl: Decimal;
  avgPnl: Decimal | null;
  netR: Decimal;
  rCount: number;
}

/** Ranked most costly first (lowest net P&L). Open trades are ignored; tags never used are omitted. */
export function mistakeCosts(trades: MistakeTrade[]): MistakeCost[] {
  const costs = new Map<string, MistakeCost>();
  for (const t of trades) {
    if (t.status !== "CLOSED") continue;
    const pnl = toDecimalOrNull(t.pnl);
    if (!pnl) continue;
    const r = toDecimalOrNull(t.rMultiple);
    const seen = new Set<string>();
    for (const tag of t.tags) {
      if (tag.kind !== "MISTAKE" || seen.has(tag.id)) continue;
      seen.add(tag.id);
      const c = costs.get(tag.id) ?? { tagId: tag.id, name: tag.name, count: 0, netPnl: ZERO, avgPnl: null, netR: ZERO, rCount: 0 };
      c.count++;
      c.netPnl = c.netPnl.plus(pnl);
      if (r) {
        c.netR = c.netR.plus(r);
        c.rCount++;
      }
      costs.set(tag.id, c);
    }
  }
  const out = [...costs.values()].map((c) => ({ ...c, avgPnl: c.count ? c.netPnl.div(c.count) : null }));
  out.sort((a, b) => a.netPnl.comparedTo(b.netPnl) || b.count - a.count || a.name.localeCompare(b.name));
  return out;
}

/** True when the trade carries at least one MISTAKE tag. */
export function hasMistake(trade: Pick<MistakeTrade, "tags">): boolean {
  return trade.tags.some((t) => t.kind === "MISTAKE");
}
