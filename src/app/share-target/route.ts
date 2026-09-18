import { NextResponse } from "next/server";
import { safeFilename } from "@/lib/attachments";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { requireSameOrigin } from "@/lib/origin-guard";
import { checkStorage, prunePendingUploads } from "@/lib/queries/storage";
import { MAX_UPLOAD_BYTES, saveUpload, sniffImageType } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/**
 * Web Share Target: the phone's share sheet posts a screenshot here and the
 * owner lands on the new-trade form with the image attached as a draft. The
 * post is a top-level form submission by the installed app, so a missing
 * Origin is accepted; a foreign one is refused.
 */
export async function POST(request: Request) {
  const refused = requireSameOrigin(request, { allowMissing: true });
  if (refused) return refused;
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login?next=%2Ftrades%2Fnew", request.url), 303);

  let text = "";
  let draftId: string | null = null;
  let notice: "storage" | null = null;
  try {
    await prunePendingUploads();
    const form = await request.formData();
    text = [form.get("title"), form.get("text")]
      .filter((v): v is string => typeof v === "string" && v.trim() !== "")
      .join(" — ")
      .slice(0, 500);
    const file = form.get("screenshot");
    if (file instanceof File && file.size > 0 && file.size <= MAX_UPLOAD_BYTES) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mimeType = sniffImageType(bytes);
      if (mimeType && !(await checkStorage(user.id, bytes.length)).ok) {
        notice = "storage";
      } else if (mimeType) {
        const storedName = await saveUpload(user.id, bytes, mimeType);
        const pending = await db.pendingUpload.create({
          data: { userId: user.id, filename: safeFilename(file.name, "shared-screenshot"), storedName, mimeType, size: bytes.length, note: text || null },
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
  if (notice) target.searchParams.set("notice", notice);
  return NextResponse.redirect(target, 303);
}

export async function GET(request: Request) {
  return NextResponse.redirect(new URL("/trades/new", request.url), 303);
}
