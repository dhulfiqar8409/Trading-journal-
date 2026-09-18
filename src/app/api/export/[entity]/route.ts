import Papa from "papaparse";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { toPlainString } from "@/lib/decimal";

export const dynamic = "force-dynamic";

const ENTITIES = ["days", "rules", "tags", "accounts"] as const;

/** CSV export of days, rules, tags or accounts (trades have their own route). */
export async function GET(_request: Request, context: { params: Promise<{ entity: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { entity } = await context.params;
  const name = entity.replace(/\.csv$/, "");
  if (!(ENTITIES as readonly string[]).includes(name)) return NextResponse.json({ error: "Unknown export" }, { status: 404 });

  let rows: Record<string, unknown>[] = [];
  if (name === "days") {
    const days = await db.day.findMany({ where: { userId: user.id }, orderBy: { date: "asc" } });
    rows = days.map((d) => ({
      date: d.date,
      maxTrades: d.maxTrades ?? "",
      maxLossR: toPlainString(d.maxLossR) ?? "",
      allowedSetupIds: d.allowedSetupIds.join("; "),
      focusNote: d.focusNote ?? "",
      mood: d.mood ?? "",
      sleepHours: toPlainString(d.sleepHours) ?? "",
      focus: d.focus ?? "",
      energy: d.energy ?? "",
      checkedInAt: d.checkedInAt?.toISOString() ?? "",
      wentRight: d.wentRight ?? "",
      wentWrong: d.wentWrong ?? "",
      oneChange: d.oneChange ?? "",
      reviewedAt: d.reviewedAt?.toISOString() ?? "",
      dayTags: d.dayTags.join("; "),
    }));
  } else if (name === "rules") {
    const rules = await db.rule.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" }, include: { _count: { select: { events: true } } } });
    rows = rules.map((r) => ({ id: r.id, title: r.title, kind: r.kind, value: toPlainString(r.value) ?? "", timeValue: r.timeValue ?? "", active: r.active, checks: r._count.events, createdAt: r.createdAt.toISOString() }));
  } else if (name === "tags") {
    const tags = await db.tag.findMany({ where: { userId: user.id }, orderBy: { name: "asc" }, include: { _count: { select: { trades: true } } } });
    rows = tags.map((t) => ({ id: t.id, name: t.name, kind: t.kind, color: t.color, trades: t._count.trades }));
  } else {
    const accounts = await db.account.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
    rows = accounts.map((a) => ({ id: a.id, name: a.name, broker: a.broker ?? "", currency: a.currency, isDefault: a.isDefault }));
  }
  const csv = Papa.unparse(rows, { newline: "\r\n", escapeFormulae: true });
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return new Response(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="darkpools-${name}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
