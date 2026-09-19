"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { deleteUploads } from "@/lib/uploads";

/**
 * Removes every trade an import created, with their screenshots and rule
 * events, and the batch itself. Trades the owner added or edited since are
 * gone too when they came from this import; nothing else is touched.
 */
export async function undoImportBatchAction(batchId: string): Promise<void> {
  const user = await requireUser();
  const batch = await db.importBatch.findFirst({ where: { id: batchId, userId: user.id }, select: { id: true } });
  if (!batch) return;
  const attachments = await db.attachment.findMany({ where: { trade: { importBatchId: batch.id, userId: user.id } }, select: { storedName: true } });
  await db.$transaction([db.trade.deleteMany({ where: { importBatchId: batch.id, userId: user.id } }), db.importBatch.delete({ where: { id: batch.id } })]);
  await deleteUploads(user.id, attachments.map((a) => a.storedName));
  for (const path of ["/import", "/trades", "/", "/today", "/reports"]) revalidatePath(path);
}
