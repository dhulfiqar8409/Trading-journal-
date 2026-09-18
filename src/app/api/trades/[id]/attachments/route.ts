import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { serializeAttachment } from "@/lib/serialize";
import { MAX_UPLOAD_BYTES, saveUpload, sniffImageType } from "@/lib/uploads";

export const dynamic = "force-dynamic";

function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "screenshot";
  return base.replace(/[^\w.\- ()]/g, "_").slice(0, 200) || "screenshot";
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const trade = await db.trade.findFirst({ where: { id, userId: user.id }, select: { id: true } });
  if (!trade) return NextResponse.json({ error: "Trade not found" }, { status: 404 });

  let file: File | null = null;
  try {
    const form = await request.formData();
    const entry = form.get("file");
    if (entry instanceof File) file = entry;
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "Images must be 10 MB or smaller" }, { status: 413 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "Images must be 10 MB or smaller" }, { status: 413 });
  const mimeType = sniffImageType(bytes);
  if (!mimeType) return NextResponse.json({ error: "Only PNG, JPEG, GIF and WebP images are accepted" }, { status: 415 });

  const storedName = await saveUpload(user.id, bytes, mimeType);
  const attachment = await db.attachment.create({
    data: { tradeId: trade.id, filename: safeFilename(file.name), storedName, mimeType, size: bytes.length },
  });
  return NextResponse.json(serializeAttachment(attachment), { status: 201 });
}
