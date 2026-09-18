import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";

export function newShareToken(): string {
  return randomBytes(18).toString("base64url");
}

/** An active share link by token, or null when unknown or revoked. */
export async function findActiveShare(token: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  return db.shareLink.findFirst({
    where: { token, revokedAt: null },
    include: { user: { select: { id: true, timeZone: true, displayMode: true, name: true } } },
  });
}
