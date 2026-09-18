import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { toPlainString } from "@/lib/decimal";

export const dynamic = "force-dynamic";

/** Everything the owner logged, as one JSON document. Screenshots are referenced by file name only. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [accounts, tags, trades, days, rules] = await Promise.all([
    db.account.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
    db.tag.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } }),
    db.trade.findMany({
      where: { userId: user.id },
      orderBy: [{ entryAt: "asc" }, { createdAt: "asc" }],
      include: { tags: { select: { id: true } }, attachments: true, ruleEvents: true },
    }),
    db.day.findMany({ where: { userId: user.id }, orderBy: { date: "asc" } }),
    db.rule.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
  ]);
  const dec = (v: unknown) => (v === null || v === undefined ? null : toPlainString(v as { toString(): string }));
  const payload = {
    format: "darkpools-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    owner: { username: user.username, name: user.name, email: user.email, timeZone: user.timeZone, displayMode: user.displayMode },
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, broker: a.broker, currency: a.currency, isDefault: a.isDefault, createdAt: a.createdAt })),
    tags: tags.map((t) => ({ id: t.id, name: t.name, kind: t.kind, color: t.color })),
    rules: rules.map((r) => ({ id: r.id, title: r.title, kind: r.kind, value: dec(r.value), timeValue: r.timeValue, active: r.active, createdAt: r.createdAt })),
    days: days.map((d) => ({
      date: d.date,
      maxTrades: d.maxTrades,
      maxLossR: dec(d.maxLossR),
      allowedSetupIds: d.allowedSetupIds,
      focusNote: d.focusNote,
      mood: d.mood,
      sleepHours: dec(d.sleepHours),
      focus: d.focus,
      energy: d.energy,
      checkedInAt: d.checkedInAt,
      wentRight: d.wentRight,
      wentWrong: d.wentWrong,
      oneChange: d.oneChange,
      reviewedAt: d.reviewedAt,
      dayTags: d.dayTags,
    })),
    trades: trades.map((t) => ({
      id: t.id,
      accountId: t.accountId,
      symbol: t.symbol,
      assetClass: t.assetClass,
      side: t.side,
      status: t.status,
      quantity: dec(t.quantity),
      entryPrice: dec(t.entryPrice),
      exitPrice: dec(t.exitPrice),
      multiplier: dec(t.multiplier),
      fees: dec(t.fees),
      entryAt: t.entryAt,
      exitAt: t.exitAt,
      pnl: dec(t.pnl),
      rMultiple: dec(t.rMultiple),
      plannedRisk: dec(t.plannedRisk),
      stopPrice: dec(t.stopPrice),
      targetPrice: dec(t.targetPrice),
      rating: t.rating,
      notes: t.notes,
      mistakes: t.mistakes,
      tagIds: t.tags.map((tag) => tag.id),
      attachments: t.attachments.map((a) => ({ filename: a.filename, storedName: a.storedName, mimeType: a.mimeType, size: a.size })),
      ruleEvents: t.ruleEvents.map((e) => ({ ruleId: e.ruleId, status: e.status, justification: e.justification })),
      importHash: t.importHash,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })),
  };
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="darkpools-export-${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
