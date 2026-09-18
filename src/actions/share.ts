"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { newShareToken } from "@/lib/share";
import { parseIsoWeekKey } from "@/lib/weeks";

/** Creates a read-only link for one trade or one week and returns to the page that asked for it. */
export async function createShareLinkAction(kind: "TRADE" | "WEEK", targetId: string, returnTo: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  const hideDollars = formData.get("hideDollars") === "on";
  if (kind === "TRADE") {
    const trade = await db.trade.findFirst({ where: { id: targetId, userId: user.id }, select: { id: true } });
    if (!trade) redirect(returnTo);
  } else if (!parseIsoWeekKey(targetId)) {
    redirect(returnTo);
  }
  await db.shareLink.create({ data: { userId: user.id, kind, targetId, token: newShareToken(), hideDollars } });
  revalidatePath(returnTo);
  revalidatePath("/settings");
  redirect(returnTo);
}

export async function revokeShareLinkAction(linkId: string, returnTo: string): Promise<void> {
  const user = await requireUser();
  await db.shareLink.updateMany({ where: { id: linkId, userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  revalidatePath(returnTo);
  revalidatePath("/settings");
  redirect(returnTo);
}
