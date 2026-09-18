import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { uploadPath } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/** Serves a shared-but-not-yet-attached screenshot to its owner. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const pending = await db.pendingUpload.findFirst({ where: { id, userId: user.id }, select: { storedName: true, mimeType: true } });
  if (!pending) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const data = await readFile(uploadPath(user.id, pending.storedName));
    return new Response(new Uint8Array(data), {
      headers: { "Content-Type": pending.mimeType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return NextResponse.json({ error: "File missing" }, { status: 404 });
  }
}
