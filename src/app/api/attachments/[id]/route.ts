import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { safeFilename } from "@/lib/attachments";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { uploadPath } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/** Serves a screenshot to its owner only, uncached. Files never live under /public. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const attachment = await db.attachment.findFirst({
    where: { id, trade: { userId: user.id } },
    select: { storedName: true, mimeType: true, filename: true, size: true },
  });
  if (!attachment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let data: Buffer;
  try {
    data = await readFile(uploadPath(user.id, attachment.storedName));
  } catch {
    return NextResponse.json({ error: "File missing" }, { status: 404 });
  }
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Length": String(data.length),
      "Content-Disposition": `inline; filename="${safeFilename(attachment.filename)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
