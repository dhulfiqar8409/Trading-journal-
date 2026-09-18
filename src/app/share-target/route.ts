import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { MAX_UPLOAD_BYTES, saveUpload, sniffImageType } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/**
 * Web Share Target: the phone's share sheet posts a screenshot here and the
 * owner lands on the new-trade form with the image attached as a draft.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login?next=%2Ftrades%2Fnew", request.url), 303);

  let text = "";
  let draftId: string | null = null;
  try {
    const form = await request.formData();
    text = [form.get("title"), form.get("text")]
      .filter((v): v is string => typeof v === "string" && v.trim() !== "")
      .join(" — ")
      .slice(0, 500);
    const file = form.get("screenshot");
    if (file instanceof File && file.size > 0 && file.size <= MAX_UPLOAD_BYTES) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mimeType = sniffImageType(bytes);
      if (mimeType) {
        const storedName = await saveUpload(user.id, bytes, mimeType);
        const pending = await db.pendingUpload.create({
          data: { userId: user.id, filename: (file.name || "shared-screenshot").slice(0, 200), storedName, mimeType, size: bytes.length, note: text || null },
          select: { id: true },
        });
        draftId = pending.id;
      }
    }
  } catch (error) {
    console.error("share target failed", error);
  }
  const target = new URL("/trades/new", request.url);
  if (draftId) target.searchParams.set("draft", draftId);
  else if (text) target.searchParams.set("note", text);
  return NextResponse.redirect(target, 303);
}

export async function GET(request: Request) {
  return NextResponse.redirect(new URL("/trades/new", request.url), 303);
}
