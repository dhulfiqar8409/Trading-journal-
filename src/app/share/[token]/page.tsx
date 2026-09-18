import Link from "next/link";
import { notFound } from "next/navigation";
import { LogoMark } from "@/components/icons";
import { Markdown } from "@/components/markdown";
import { SideBadge, StatusBadge } from "@/components/pnl";
import { TagChip } from "@/components/tag-chip";
import { WeekCard } from "@/components/week-card";
import { db } from "@/lib/db";
import { formatDateTime, formatMoney, formatPrice, formatR, pnlClass } from "@/lib/format";
import { tradeLabel } from "@/lib/options";
import { loadWeekReview } from "@/lib/queries/week";
import { serializeTrade } from "@/lib/serialize";
import { findActiveShare } from "@/lib/share";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const share = await findActiveShare(token);
  if (!share) return { title: "Link not found" };
  return {
    title: share.kind === "WEEK" ? "Week in review" : "Shared trade",
    robots: { index: false },
    ...(share.kind === "WEEK" ? { openGraph: { images: [`/share/${token}/opengraph-image`] } } : {}),
  };
}

/** Public, read-only view of one trade or one week. No navigation, no other data. */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const share = await findActiveShare(token);
  if (!share) notFound();
  const { user } = share;

  let body: React.ReactNode;
  if (share.kind === "WEEK") {
    const week = await loadWeekReview(user.id, user.timeZone, share.targetId);
    if (!week) notFound();
    body = <WeekCard week={week} hideDollars={share.hideDollars} mode={user.displayMode} />;
  } else {
    const record = await db.trade.findFirst({
      where: { id: share.targetId, userId: user.id },
      include: { account: { select: { id: true, name: true, currency: true } }, tags: { orderBy: { name: "asc" } }, attachments: { orderBy: { createdAt: "asc" } } },
    });
    if (!record) notFound();
    const trade = serializeTrade(record);
    const hide = share.hideDollars;
    body = (
      <div className="card hero-card card-pad">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{tradeLabel(trade)}</h1>
          <SideBadge side={trade.side} />
          <StatusBadge status={trade.status} />
          <span className="badge">{trade.assetClass}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-6">
          <div>
            <p className="text-xs text-muted">Result</p>
            <p className={`figure text-3xl leading-none ${pnlClass(trade.rMultiple ?? trade.pnl)}`}>
              {trade.status === "OPEN" ? "Open" : trade.rMultiple !== null ? formatR(trade.rMultiple) : hide ? "—" : formatMoney(trade.pnl, { currency: trade.currency, signed: true })}
            </p>
            {!hide && trade.status === "CLOSED" && trade.rMultiple !== null ? <p className="mt-1 text-xs text-muted">{formatMoney(trade.pnl, { currency: trade.currency, signed: true })}</p> : null}
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            <dt className="text-muted">Entry</dt>
            <dd className="num">{formatPrice(trade.entryPrice)}</dd>
            <dt className="text-muted">Exit</dt>
            <dd className="num">{formatPrice(trade.exitPrice)}</dd>
            <dt className="text-muted">Stop</dt>
            <dd className="num">{formatPrice(trade.stopPrice)}</dd>
            <dt className="text-muted">Entered</dt>
            <dd className="num">{formatDateTime(trade.entryAt, user.timeZone)}</dd>
          </dl>
        </div>
        {trade.tags.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {trade.tags.map((tag) => (
              <TagChip key={tag.id} tag={tag} />
            ))}
          </div>
        ) : null}
        <div className="mt-4">
          <Markdown source={trade.notes} />
        </div>
        {trade.attachments.length ? (
          <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {trade.attachments.map((a) => (
              <li key={a.id} className="overflow-hidden rounded-lg border border-line bg-canvas">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/share/${token}/attachments/${a.id}`} alt={a.filename} loading="lazy" className="aspect-[4/3] w-full object-cover" />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-4 px-4 py-8">
      <div className="flex items-center justify-between">
        <span className="wordmark flex items-center gap-2">
          <LogoMark /> Darkpools
        </span>
        <span className="text-xs text-muted">Shared by {user.name} · read-only</span>
      </div>
      {body}
      <p className="text-center text-xs text-muted">
        <Link href="/" className="hover:text-ink">
          darkpools
        </Link>{" "}
        · a personal trading journal
      </p>
    </div>
  );
}
