import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { findActiveShare } from "@/lib/share";
import { uploadPath } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/** Screenshots of a shared trade, reachable only through an active share link for that trade. */
export async function GET(_request: Request, context: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await context.params;
  const share = await findActiveShare(token);
  if (!share || share.kind !== "TRADE") return NextResponse.json({ error: "Not found" }, { status: 404 });
  const attachment = await db.attachment.findFirst({
    where: { id, tradeId: share.targetId, trade: { userId: share.user.id } },
    select: { storedName: true, mimeType: true },
  });
  if (!attachment) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const data = await readFile(uploadPath(share.user.id, attachment.storedName));
    return new Response(new Uint8Array(data), {
      headers: { "Content-Type": attachment.mimeType, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return NextResponse.json({ error: "File missing" }, { status: 404 });
  }
}
