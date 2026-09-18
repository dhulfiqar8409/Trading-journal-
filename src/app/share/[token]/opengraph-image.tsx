import { notFound } from "next/navigation";
import { weekCardImage, weekImageSize } from "@/components/week-card-image";
import { loadWeekReview } from "@/lib/queries/week";
import { findActiveShare } from "@/lib/share";

export const dynamic = "force-dynamic";
export const size = weekImageSize;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const share = await findActiveShare(token);
  if (!share || share.kind !== "WEEK") notFound();
  const week = await loadWeekReview(share.user.id, share.user.timeZone, share.targetId);
  if (!week) notFound();
  return weekCardImage(week, share.hideDollars);
}
