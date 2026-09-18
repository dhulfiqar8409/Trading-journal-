import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteAttachmentAction, deleteTradeAction, updateTradeAction } from "@/actions/trades";
import { AttachmentUploader } from "@/components/attachments";
import { CloseTrade } from "@/components/close-trade";
import { ConfirmSubmit } from "@/components/confirm-button";
import { Markdown } from "@/components/markdown";
import { PnlFigure } from "@/components/figure";
import { ShareLinks } from "@/components/share-links";
import { RMultiple, SideBadge, StatusBadge } from "@/components/pnl";
import { TagChip } from "@/components/tag-chip";
import { TradeForm } from "@/components/trade-form";
import { closeTarget } from "@/lib/close-target";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateKey, formatDateTime, formatDuration, formatMoney, formatNumber, formatPrice, formatRatio } from "@/lib/format";
import { daysToExpiration, expirationKey, isOptionTrade, tradeLabel } from "@/lib/options";
import { plannedRewardRisk, riskAmount } from "@/lib/pnl";
import { getTrade } from "@/lib/queries/trades";
import { serializeRule, serializeTag, serializeTrade } from "@/lib/serialize";
import { toDateTimeLocalValue } from "@/lib/tz";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const trade = await db.trade.findFirst({ where: { id, userId: user.id }, select: { symbol: true, assetClass: true, optionType: true, strikePrice: true, expiresAt: true } });
  return { title: trade ? `${tradeLabel(trade)} trade` : "Trade" };
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-canvas px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className="num mt-0.5 text-sm text-ink">{children}</p>
    </div>
  );
}

export default async function TradeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { id } = await params;
  const { edit } = await searchParams;
  const user = await requireUser();
  const record = await getTrade(user.id, id);
  if (!record) notFound();
  const trade = serializeTrade(record);
  const [accounts, tags, customRules, shareLinks, headerList] = await Promise.all([
    db.account.findMany({ where: { userId: user.id }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
    db.tag.findMany({ where: { userId: user.id }, orderBy: [{ kind: "asc" }, { name: "asc" }] }),
    db.rule.findMany({ where: { userId: user.id, active: true, kind: "CUSTOM" }, orderBy: { createdAt: "asc" } }),
    db.shareLink.findMany({ where: { userId: user.id, kind: "TRADE", targetId: id, revokedAt: null }, orderBy: { createdAt: "desc" } }),
    headers(),
  ]);
  const origin = `${headerList.get("x-forwarded-proto") ?? "http"}://${headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000"}`;

  const pnlInput = {
    side: trade.side,
    quantity: trade.quantity,
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice,
    multiplier: trade.multiplier,
    fees: trade.fees,
    stopPrice: trade.stopPrice,
    targetPrice: trade.targetPrice,
  };
  const risk = riskAmount(pnlInput);
  const plannedRR = plannedRewardRisk(pnlInput);
  const updateAction = updateTradeAction.bind(null, trade.id);
  const deleteAction = deleteTradeAction.bind(null, trade.id);
  const label = tradeLabel(trade);
  const option = isOptionTrade(trade);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/trades" className="text-sm text-muted hover:text-ink">
          ← Trades
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{label}</h1>
          <SideBadge side={trade.side} />
          <StatusBadge status={trade.status} />
          <span className="badge">{trade.assetClass}</span>
          <span className="text-sm text-muted">{trade.accountName}</span>
          {trade.status === "OPEN" ? (
            <div className="ml-auto">
              <CloseTrade trade={closeTarget(trade, label)} timeZone={user.timeZone} primary />
            </div>
          ) : null}
        </div>
      </div>

      <div className="card card-pad">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs text-muted">{trade.status === "OPEN" ? "Open position" : user.displayMode === "R" ? "Net R" : "Net P&L"}</p>
            {trade.status === "OPEN" ? (
              <p className="text-3xl font-semibold text-ink-2">—</p>
            ) : (
              <PnlFigure pnl={trade.pnl} r={trade.rMultiple} currency={trade.currency} mode={user.displayMode} className="text-3xl font-semibold" />
            )}
          </div>
          <div className="flex gap-6 text-sm">
            <div>
              <p className="text-xs text-muted">R-multiple</p>
              <RMultiple value={trade.rMultiple} className="text-lg font-semibold" />
            </div>
            <div>
              <p className="text-xs text-muted">Risk</p>
              <p className="num text-lg font-semibold">{risk ? formatMoney(risk.toFixed(), { currency: trade.currency }) : "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Planned R:R</p>
              <p className="num text-lg font-semibold">{plannedRR ? formatRatio(plannedRR.toFixed()) : "—"}</p>
            </div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Fact label={option ? "Contracts" : "Quantity"}>{formatNumber(trade.quantity, 8)}</Fact>
          {option ? (
            <>
              <Fact label="Contract">
                {trade.optionType === "CALL" ? "Call" : "Put"} · strike {formatPrice(trade.strikePrice)}
              </Fact>
              <Fact label="Expires">
                {formatDateKey(expirationKey(trade.expiresAt as string))}
                <span className="text-muted"> · {daysToExpiration(new Date(trade.entryAt), trade.expiresAt as string, user.timeZone)}d at entry</span>
              </Fact>
            </>
          ) : null}
          <Fact label="Entry">{formatPrice(trade.entryPrice)}</Fact>
          <Fact label="Exit">{formatPrice(trade.exitPrice)}</Fact>
          <Fact label="Fees">{formatMoney(trade.fees, { currency: trade.currency })}</Fact>
          <Fact label="Multiplier">{formatNumber(trade.multiplier, 8)}</Fact>
          <Fact label="Rating">{trade.rating ? `${trade.rating} / 5` : "—"}</Fact>
          <Fact label="Stop">{formatPrice(trade.stopPrice)}</Fact>
          <Fact label="Target">{formatPrice(trade.targetPrice)}</Fact>
          <Fact label="Entered">{formatDateTime(trade.entryAt, user.timeZone)}</Fact>
          <Fact label="Exited">{formatDateTime(trade.exitAt, user.timeZone)}</Fact>
          <Fact label="Held">{formatDuration(trade.entryAt, trade.exitAt)}</Fact>
          <Fact label="Source">{trade.importHash ? "CSV import" : "Manual"}</Fact>
        </div>
        {trade.tags.length ? (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {trade.tags.map((tag) => (
              <TagChip key={tag.id} tag={tag} />
            ))}
          </div>
        ) : null}
      </div>

      {trade.ruleEvents.length ? (
        <section className="card card-pad" aria-label="Rules">
          <h2 className="mb-2 text-sm font-semibold">Rules</h2>
          <ul className="flex flex-col gap-1.5 text-sm">
            {trade.ruleEvents.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2">
                <span className={`badge ${e.status === "BROKEN" ? "border-warn/50 text-warn" : e.status === "OVERRIDDEN" ? "border-accent/40 text-accent-strong" : "text-ink-2"}`}>
                  {e.status === "FOLLOWED" ? "Followed" : e.status === "BROKEN" ? "Broken" : "Exception"}
                </span>
                <span>{e.ruleTitle}</span>
                {e.justification ? <span className="text-muted">— “{e.justification}”</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card card-pad">
          <h2 className="mb-2 text-sm font-semibold">Notes</h2>
          <Markdown source={trade.notes} />
          {trade.mistakes ? (
            <div className="mt-4 rounded-lg border border-loss-mark/30 bg-loss-soft px-3 py-2">
              <p className="text-xs font-medium text-loss">Mistakes</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink-2">{trade.mistakes}</p>
            </div>
          ) : null}
        </section>

        <section className="card card-pad">
          <h2 className="mb-2 text-sm font-semibold">Screenshots</h2>
          {trade.attachments.length ? (
            <ul className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {trade.attachments.map((a) => (
                <li key={a.id} className="group relative overflow-hidden rounded-lg border border-line bg-canvas">
                  <a href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer" className="block aspect-[4/3]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/attachments/${a.id}`} alt={a.filename} loading="lazy" className="h-full w-full object-cover" />
                  </a>
                  <form action={deleteAttachmentAction.bind(null, a.id)} className="absolute right-1 top-1">
                    <ConfirmSubmit message={`Delete ${a.filename}?`} className="btn btn-sm btn-danger bg-canvas/90">
                      Delete
                    </ConfirmSubmit>
                  </form>
                  <p className="truncate px-2 py-1 text-[11px] text-muted">{a.filename}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-sm text-muted">No screenshots attached.</p>
          )}
          <AttachmentUploader tradeId={trade.id} />
        </section>
      </div>

      <section className="card card-pad" aria-label="Share">
        <h2 className="mb-2 text-sm font-semibold">Share</h2>
        <ShareLinks kind="TRADE" targetId={trade.id} returnTo={`/trades/${trade.id}`} origin={origin} links={shareLinks.map((l) => ({ id: l.id, token: l.token, hideDollars: l.hideDollars, createdAt: l.createdAt.toISOString() }))} />
      </section>

      <details className="card" open={edit === "1"}>
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold sm:px-5">Edit trade</summary>
        <div className="border-t border-line p-4 sm:p-5">
          <TradeForm
            action={updateAction}
            accounts={accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency, isDefault: a.isDefault }))}
            tags={tags.map(serializeTag)}
            timeZone={user.timeZone}
            initial={trade}
            defaultEntryAt={toDateTimeLocalValue(new Date(), user.timeZone)}
            submitLabel="Save changes"
            customRules={customRules.map(serializeRule)}
            currency={trade.currency}
          />
        </div>
      </details>

      <form action={deleteAction} className="flex justify-end">
        <ConfirmSubmit message="Delete this trade and its screenshots? This cannot be undone.">Delete trade</ConfirmSubmit>
      </form>
    </div>
  );
}
