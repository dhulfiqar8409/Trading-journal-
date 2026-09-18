import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { parseImportRow, type ParsedImportRow } from "@/lib/csv";
import { db } from "@/lib/db";
import { hashKey } from "@/lib/import-hash";
import { importRequestSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const CHUNK = 500;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }
  const parsed = importRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid import request" }, { status: 400 });
  }
  const { accountId, mapping, options, rows } = parsed.data;
  const account = await db.account.findFirst({ where: { id: accountId, userId: user.id }, select: { id: true } });
  if (!account) return NextResponse.json({ error: "Unknown account" }, { status: 400 });

  // Re-parse every row on the server; the browser preview is only a convenience.
  const errors: { row: number; message: string }[] = [];
  const candidates: { row: number; parsed: ParsedImportRow; hash: string }[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  rows.forEach((record, i) => {
    const rowNumber = i + 2; // header is line 1
    const result = parseImportRow(record, mapping, options);
    if (!result.ok) {
      errors.push({ row: rowNumber, message: result.error });
      return;
    }
    const hash = hashKey(result.row.importHashKey);
    if (seen.has(hash)) {
      duplicates++;
      return;
    }
    seen.add(hash);
    candidates.push({ row: rowNumber, parsed: result.row, hash });
  });

  const existing = new Set<string>();
  for (let i = 0; i < candidates.length; i += 1000) {
    const hashes = candidates.slice(i, i + 1000).map((c) => c.hash);
    const found = await db.trade.findMany({ where: { userId: user.id, importHash: { in: hashes } }, select: { importHash: true } });
    for (const f of found) if (f.importHash) existing.add(f.importHash);
  }
  const fresh = candidates.filter((c) => !existing.has(c.hash));
  duplicates += candidates.length - fresh.length;

  let inserted = 0;
  try {
    for (let i = 0; i < fresh.length; i += CHUNK) {
      const data: Prisma.TradeCreateManyInput[] = fresh.slice(i, i + CHUNK).map(({ parsed: p, hash }) => ({
        userId: user.id,
        accountId: account.id,
        symbol: p.symbol,
        assetClass: p.assetClass,
        side: p.side,
        quantity: p.quantity,
        entryPrice: p.entryPrice,
        exitPrice: p.exitPrice,
        multiplier: p.multiplier,
        fees: p.fees,
        entryAt: p.entryAt,
        exitAt: p.exitAt,
        status: p.status,
        pnl: p.pnl,
        rMultiple: p.rMultiple,
        stopPrice: p.stopPrice,
        targetPrice: p.targetPrice,
        notes: p.notes,
        importHash: hash,
      }));
      const result = await db.trade.createMany({ data, skipDuplicates: true });
      inserted += result.count;
      duplicates += data.length - result.count;
    }
  } catch (error) {
    console.error("import failed", error);
    return NextResponse.json({ error: "Import failed while saving trades. Some rows may have been inserted." }, { status: 500 });
  }

  revalidatePath("/");
  revalidatePath("/trades");
  return NextResponse.json({ total: rows.length, inserted, duplicates, errors });
}
