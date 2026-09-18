import Papa from "papaparse";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { toPlainString } from "@/lib/decimal";
import { expirationKey } from "@/lib/options";
import { allTrades } from "@/lib/queries/trades";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const trades = await allTrades(user.id);
  const rows = trades.map((t) => ({
    id: t.id,
    account: t.account.name,
    currency: t.account.currency,
    symbol: t.symbol,
    assetClass: t.assetClass,
    side: t.side,
    status: t.status,
    quantity: toPlainString(t.quantity),
    entryPrice: toPlainString(t.entryPrice),
    exitPrice: toPlainString(t.exitPrice) ?? "",
    multiplier: toPlainString(t.multiplier),
    fees: toPlainString(t.fees),
    entryAt: t.entryAt.toISOString(),
    exitAt: t.exitAt ? t.exitAt.toISOString() : "",
    pnl: toPlainString(t.pnl) ?? "",
    rMultiple: toPlainString(t.rMultiple) ?? "",
    stopPrice: toPlainString(t.stopPrice) ?? "",
    targetPrice: toPlainString(t.targetPrice) ?? "",
    optionType: t.optionType ?? "",
    strikePrice: toPlainString(t.strikePrice) ?? "",
    expiresAt: t.expiresAt ? expirationKey(t.expiresAt) : "",
    rating: t.rating ?? "",
    tags: t.tags.map((tag) => tag.name).join("; "),
    notes: t.notes,
    mistakes: t.mistakes ?? "",
    createdAt: t.createdAt.toISOString(),
  }));
  const csv = Papa.unparse(rows, { newline: "\r\n", escapeFormulae: true });
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return new Response(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="darkpools-trades-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
