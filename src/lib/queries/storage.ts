import "server-only";
import { attachmentQuotaBytes, PENDING_UPLOAD_MAX_AGE_MS, storageVerdict, type StorageVerdict } from "@/lib/attachments";
import { db } from "@/lib/db";
import { deleteUploads } from "@/lib/uploads";

/** Bytes an account stores on disk: screenshots attached to its trades plus shared ones still waiting for a trade. */
export async function usedAttachmentBytes(userId: string): Promise<number> {
  const [attached, pending] = await Promise.all([
    db.attachment.aggregate({ _sum: { size: true }, where: { trade: { userId } } }),
    db.pendingUpload.aggregate({ _sum: { size: true }, where: { userId } }),
  ]);
  return (attached._sum.size ?? 0) + (pending._sum.size ?? 0);
}

/** Whether an upload of `incomingBytes` fits under the account's quota. */
export async function checkStorage(userId: string, incomingBytes: number): Promise<StorageVerdict> {
  return storageVerdict(await usedAttachmentBytes(userId), incomingBytes, attachmentQuotaBytes());
}

/**
 * Drops shared screenshots that were never attached within a day, for every
 * account, files included. Runs on every share and upload request; there are
 * no background jobs.
 */
export async function prunePendingUploads(now: Date = new Date()): Promise<number> {
  const stale = await db.pendingUpload.findMany({
    where: { createdAt: { lt: new Date(now.getTime() - PENDING_UPLOAD_MAX_AGE_MS) } },
    select: { id: true, userId: true, storedName: true },
  });
  if (stale.length === 0) return 0;
  await db.pendingUpload.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
  const byUser = new Map<string, string[]>();
  for (const s of stale) byUser.set(s.userId, [...(byUser.get(s.userId) ?? []), s.storedName]);
  await Promise.all([...byUser].map(([userId, names]) => deleteUploads(userId, names)));
  return stale.length;
}
