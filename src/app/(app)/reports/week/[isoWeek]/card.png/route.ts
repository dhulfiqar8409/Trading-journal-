import { NextResponse } from "next/server";
import { weekCardImage } from "@/components/week-card-image";
import { getCurrentUser } from "@/lib/auth";
import { loadWeekReview } from "@/lib/queries/week";

export const dynamic = "force-dynamic";

/** The week-in-review share image for the owner; `?hide=1` leaves dollar amounts out. */
export async function GET(request: Request, context: { params: Promise<{ isoWeek: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { isoWeek } = await context.params;
  const week = await loadWeekReview(user.id, user.timeZone, isoWeek);
  if (!week) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const hide = new URL(request.url).searchParams.get("hide") === "1";
  const image = weekCardImage(week, hide);
  image.headers.set("Cache-Control", "private, no-store");
  image.headers.set("Content-Disposition", `inline; filename="darkpools-${isoWeek}.png"`);
  return image;
}
