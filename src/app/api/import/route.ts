import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { parseImportRow, type ParsedImportRow } from "@/lib/csv";
import { db } from "@/lib/db";
import { matchFills, parseFillRow, type Fill } from "@/lib/fills";
import { hashKey } from "@/lib/import-hash";
import { requireSameOrigin } from "@/lib/origin-guard";
import { importRequestSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const CHUNK = 500;

export async function POST(request: Request) {
  const refused = requireSameOrigin(request);
  if (refused) return refused;
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
  const { accountId, options, rows } = parsed.data;
  const account = await db.account.findFirst({ where: { id: accountId, userId: user.id }, select: { id: true } });
  if (!account) return NextResponse.json({ error: "Unknown account" }, { status: 400 });

  // Re-parse every row on the server; the browser preview is only a convenience.
  const errors: { row: number; message: string }[] = [];
  const candidates: { row: number; parsed: ParsedImportRow; hash: string }[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let unmatchedSkipped = 0;
  const consider = (rowNumber: number, row: ParsedImportRow) => {
    const hash = hashKey(row.importHashKey);
    if (seen.has(hash)) {
      duplicates++;
      return;
    }
    seen.add(hash);
    candidates.push({ row: rowNumber, parsed: row, hash });
  };
  if (parsed.data.mode === "executions") {
    // Fills become round trips per contract; closes without an open are left out unless the owner opted in.
    const fills: Fill[] = [];
    rows.forEach((record, i) => {
      const result = parseFillRow(record, parsed.data.mapping, options, i + 2);
      if (result.ok) fills.push(result.fill);
      else errors.push({ row: i + 2, message: result.error });
    });
    const match = matchFills(fills);
    const chosen = new Set(parsed.data.includeUnmatched ?? []);
    for (const trade of match.trades) consider(trade.fillRows[0], trade);
    for (const u of match.unmatched) {
      if (chosen.has(u.row)) consider(u.row, u.trade);
      else unmatchedSkipped++;
    }
  } else {
    const mapping = parsed.data.mapping;
    rows.forEach((record, i) => {
      const rowNumber = i + 2; // header is line 1
      const result = parseImportRow(record, mapping, options);
      if (!result.ok) {
        errors.push({ row: rowNumber, message: result.error });
        return;
      }
      consider(rowNumber, result.row);
    });
  }

  const existing = new Set<string>();
  for (let i = 0; i < candidates.length; i += 1000) {
    const hashes = candidates.slice(i, i + 1000).map((c) => c.hash);
    const found = await db.trade.findMany({ where: { userId: user.id, importHash: { in: hashes } }, select: { importHash: true } });
    for (const f of found) if (f.importHash) existing.add(f.importHash);
  }
  const fresh = candidates.filter((c) => !existing.has(c.hash));
  duplicates += candidates.length - fresh.length;

  // Every imported trade points at its batch, so the whole import can be undone later.
  const batch = await db.importBatch.create({
    data: { userId: user.id, filename: parsed.data.filename ?? "import.csv", mode: parsed.data.mode === "executions" ? "EXECUTIONS" : "TRADES" },
    select: { id: true },
  });
  let inserted = 0;
  let failed = false;
  try {
    for (let i = 0; i < fresh.length; i += CHUNK) {
      const data: Prisma.TradeCreateManyInput[] = fresh.slice(i, i + CHUNK).map(({ parsed: p, hash }) => ({
        userId: user.id,
        accountId: account.id,
        importBatchId: batch.id,
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
        optionType: p.optionType,
        strikePrice: p.strikePrice,
        expiresAt: p.expiresAt,
        notes: p.notes,
        importHash: hash,
      }));
      const result = await db.trade.createMany({ data, skipDuplicates: true });
      inserted += result.count;
      duplicates += data.length - result.count;
    }
  } catch (error) {
    console.error("import failed", error);
    failed = true;
  } finally {
    await db.importBatch
      .update({ where: { id: batch.id }, data: { inserted, skipped: duplicates + unmatchedSkipped, errors: errors.length } })
      .catch((error: unknown) => console.error("import batch update failed", error));
  }
  if (failed) return NextResponse.json({ error: "Import failed while saving trades. Some rows may have been inserted; undo the import from the history below." }, { status: 500 });

  revalidatePath("/");
  revalidatePath("/trades");
  revalidatePath("/import");
  return NextResponse.json({ total: rows.length, inserted, duplicates, errors, unmatched: unmatchedSkipped, batchId: batch.id });
}
