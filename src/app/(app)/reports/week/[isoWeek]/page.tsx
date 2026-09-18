import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { ShareLinks } from "@/components/share-links";
import { WeekCard } from "@/components/week-card";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadWeekReview } from "@/lib/queries/week";
import { isoWeekKey } from "@/lib/weeks";

export const metadata = { title: "Week in review" };

async function originOf(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

export default async function WeekPage({ params, searchParams }: { params: Promise<{ isoWeek: string }>; searchParams: Promise<{ hide?: string }> }) {
  const user = await requireUser();
  const { isoWeek } = await params;
  const { hide } = await searchParams;
  const week = await loadWeekReview(user.id, user.timeZone, isoWeek);
  if (!week) notFound();
  const hideDollars = hide === "1";
  const [links, origin] = await Promise.all([
    db.shareLink.findMany({ where: { userId: user.id, kind: "WEEK", targetId: isoWeek, revokedAt: null }, orderBy: { createdAt: "desc" } }),
    originOf(),
  ]);
  const returnTo = `/reports/week/${isoWeek}${hideDollars ? "?hide=1" : ""}`;
  const thisWeek = isoWeekKey(new Date(), user.timeZone);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/reports" className="text-sm text-muted hover:text-ink">
            ← Reports
          </Link>
          <h1 className="page-title mt-1">Week in review</h1>
        </div>
        <div className="flex items-center gap-1">
          <Link href={`/reports/week/${week.prevWeek}${hideDollars ? "?hide=1" : ""}`} className="btn btn-sm" aria-label="Previous week">
            <ChevronLeftIcon width={16} height={16} />
          </Link>
          {isoWeek !== thisWeek ? (
            <Link href={`/reports/week/${thisWeek}`} className="btn btn-sm">
              This week
            </Link>
          ) : null}
          <Link href={`/reports/week/${week.nextWeek}${hideDollars ? "?hide=1" : ""}`} className="btn btn-sm" aria-label="Next week">
            <ChevronRightIcon width={16} height={16} />
          </Link>
          <Link href={hideDollars ? `/reports/week/${isoWeek}` : `/reports/week/${isoWeek}?hide=1`} className={`btn btn-sm ${hideDollars ? "border-signature text-ink" : ""}`}>
            {hideDollars ? "Dollars hidden" : "Hide dollars"}
          </Link>
        </div>
      </div>

      <WeekCard week={week} hideDollars={hideDollars} mode={user.displayMode} />

      <section className="card card-pad" aria-label="Share image">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Share image</h2>
          <a href={`/reports/week/${isoWeek}/card.png${hideDollars ? "?hide=1" : ""}`} download={`darkpools-${isoWeek}.png`} className="text-xs text-accent hover:text-accent-strong">
            Download PNG
          </a>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/reports/week/${isoWeek}/card.png${hideDollars ? "?hide=1" : ""}`} alt={`Week in review card for ${week.label}`} className="w-full rounded-lg border border-line" />
      </section>

      <section className="card card-pad" aria-label="Share links">
        <h2 className="mb-2 text-sm font-semibold">Share links</h2>
        <ShareLinks kind="WEEK" targetId={isoWeek} returnTo={returnTo} origin={origin} links={links.map((l) => ({ id: l.id, token: l.token, hideDollars: l.hideDollars, createdAt: l.createdAt.toISOString() }))} />
      </section>
    </div>
  );
}
