import "server-only";
import { Decimal, toPlainString } from "@/lib/decimal";
import { db } from "@/lib/db";
import { prunePendingUploads } from "@/lib/queries/storage";

export interface CapturePrefill {
  symbol: string;
  accountId: string;
  assetClass: "STOCK" | "OPTION" | "FUTURES" | "FOREX" | "CRYPTO";
  quantity: string;
  multiplier: string;
}

export interface DraftDTO {
  id: string;
  filename: string;
  note: string | null;
  url: string;
}

/** Defaults for two-tap capture: the last trade's instrument, account and size, plus size presets. */
export async function loadCapturePrefill(userId: string): Promise<{ prefill: CapturePrefill | null; sizePresets: string[] }> {
  const last = await db.trade.findFirst({
    where: { userId },
    orderBy: [{ createdAt: "desc" }],
    select: { symbol: true, accountId: true, assetClass: true, quantity: true, multiplier: true },
  });
  if (!last) return { prefill: null, sizePresets: [] };
  const recent = await db.trade.findMany({
    where: { userId, symbol: last.symbol },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { quantity: true },
  });
  const counts = new Map<string, number>();
  for (const t of recent) {
    const q = toPlainString(t.quantity) ?? "0";
    counts.set(q, (counts.get(q) ?? 0) + 1);
  }
  const lastQty = new Decimal(toPlainString(last.quantity) ?? "0");
  const presets = new Set<string>();
  for (const q of [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([q]) => q).slice(0, 3)) presets.add(q);
  if (lastQty.greaterThan(0)) {
    presets.add(lastQty.div(2).toDecimalPlaces(8).toFixed());
    presets.add(lastQty.times(2).toDecimalPlaces(8).toFixed());
  }
  const sizePresets = [...presets].filter((q) => new Decimal(q).greaterThan(0)).sort((a, b) => new Decimal(a).comparedTo(new Decimal(b))).slice(0, 5);
  return {
    prefill: {
      symbol: last.symbol,
      accountId: last.accountId,
      assetClass: last.assetClass,
      quantity: toPlainString(last.quantity) ?? "",
      multiplier: toPlainString(last.multiplier) ?? "1",
    },
    sizePresets,
  };
}

/** The shared screenshot waiting to be attached, after the housekeeping for stale ones. */
export async function loadDraft(userId: string, draftId: string | undefined): Promise<DraftDTO | null> {
  await prunePendingUploads();
  if (!draftId) return null;
  const pending = await db.pendingUpload.findFirst({ where: { id: draftId, userId }, select: { id: true, filename: true, note: true } });
  if (!pending) return null;
  return { id: pending.id, filename: pending.filename, note: pending.note, url: `/api/pending/${pending.id}` };
}
