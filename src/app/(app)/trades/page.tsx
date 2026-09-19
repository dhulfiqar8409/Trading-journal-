import Link from "next/link";
import { BulkActions } from "@/components/bulk-actions";
import { CloseTrade } from "@/components/close-trade";
import { Pagination } from "@/components/pagination";
import { PnlFigure } from "@/components/figure";
import { RMultiple, SideBadge, StatusBadge } from "@/components/pnl";
import { TagChip } from "@/components/tag-chip";
import { closeTarget } from "@/lib/close-target";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateTime, formatNumber, formatPrice, formatShortDate } from "@/lib/format";
import { tradeLabel } from "@/lib/options";
import { listTrades } from "@/lib/queries/trades";
import { flattenSearchParams, withParams, type SearchParams } from "@/lib/search-params";
import { serializeTrade } from "@/lib/serialize";
import { PAGE_SIZES, TRADE_SORT_KEYS, tradeFilterSchema } from "@/lib/validation";

export const metadata = { title: "Trades" };

const SORT_LABELS: Record<(typeof TRADE_SORT_KEYS)[number], string> = {
  entryAt: "Entry",
  exitAt: "Exit",
  symbol: "Symbol",
  pnl: "P&L",
  quantity: "Qty",
  rMultiple: "R",
};

export default async function TradesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const raw = flattenSearchParams(await searchParams);
  const parsed = tradeFilterSchema.safeParse(raw);
  const filters = parsed.success ? parsed.data : {};
  const [result, tags, accounts] = await Promise.all([
    listTrades(user.id, filters, user.timeZone),
    db.tag.findMany({ where: { userId: user.id }, orderBy: [{ kind: "asc" }, { name: "asc" }] }),
    db.account.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } }),
  ]);
  const trades = result.trades.map(serializeTrade);
  const sort = filters.sort ?? "entryAt";
  const dir = filters.dir ?? "desc";
  const hasFilters = Object.entries(raw).some(([k, v]) => v && !["page", "sort", "dir", "pageSize", "deleted"].includes(k));
  const deleted = raw.deleted && /^\d+$/.test(raw.deleted) ? Number(raw.deleted) : null;
  const filterParams = Object.fromEntries(Object.entries(raw).filter(([k, v]) => v && !["page", "sort", "dir", "pageSize", "deleted"].includes(k)));
  const returnTo = `/trades${withParams(raw, { deleted: null })}`;

  const sortHref = (key: (typeof TRADE_SORT_KEYS)[number]) =>
    withParams(raw, { sort: key, dir: sort === key && dir === "desc" ? "asc" : "desc", page: null });
  const sortLabel = (key: (typeof TRADE_SORT_KEYS)[number]) => (
    <Link href={sortHref(key)} className={`inline-flex items-center gap-1 hover:text-ink ${sort === key ? "text-ink" : ""}`}>
      {SORT_LABELS[key]}
      {sort === key ? <span aria-hidden>{dir === "desc" ? "↓" : "↑"}</span> : null}
    </Link>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="page-title">Trades</h1>
        <Link href="/trades/new" className="btn btn-primary">
          New trade
        </Link>
      </div>

      <form method="get" className="card card-pad grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <div className="col-span-2 sm:col-span-1 lg:col-span-1">
          <label htmlFor="f-symbol" className="label">
            Symbol
          </label>
          <input id="f-symbol" name="symbol" defaultValue={raw.symbol ?? ""} className="input uppercase" placeholder="Any" />
        </div>
        <div>
          <label htmlFor="f-from" className="label">
            From
          </label>
          <input id="f-from" name="from" type="date" defaultValue={raw.from ?? ""} className="input" />
        </div>
        <div>
          <label htmlFor="f-to" className="label">
            To
          </label>
          <input id="f-to" name="to" type="date" defaultValue={raw.to ?? ""} className="input" />
        </div>
        <div>
          <label htmlFor="f-side" className="label">
            Side
          </label>
          <select id="f-side" name="side" defaultValue={raw.side ?? ""} className="input">
            <option value="">Any</option>
            <option value="LONG">Long</option>
            <option value="SHORT">Short</option>
          </select>
        </div>
        <div>
          <label htmlFor="f-status" className="label">
            Status
          </label>
          <select id="f-status" name="status" defaultValue={raw.status ?? ""} className="input">
            <option value="">Any</option>
            <option value="OPEN">Open</option>
            <option value="CLOSED">Closed</option>
          </select>
        </div>
        <div>
          <label htmlFor="f-tag" className="label">
            Tag
          </label>
          <select id="f-tag" name="tag" defaultValue={raw.tag ?? ""} className="input">
            <option value="">Any</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="f-account" className="label">
            Account
          </label>
          <select id="f-account" name="account" defaultValue={raw.account ?? ""} className="input">
            <option value="">Any</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2 flex items-end gap-2 sm:col-span-1">
          {raw.sort ? <input type="hidden" name="sort" value={raw.sort} /> : null}
          {raw.dir ? <input type="hidden" name="dir" value={raw.dir} /> : null}
          <button type="submit" className="btn btn-primary flex-1">
            Apply
          </button>
          {hasFilters ? (
            <Link href="/trades" className="btn">
              Reset
            </Link>
          ) : null}
        </div>
      </form>

      {deleted !== null ? (
        <p role="status" className="rounded-lg border border-profit-mark/40 bg-profit-soft px-3 py-2 text-sm text-profit">
          Deleted {deleted} trade{deleted === 1 ? "" : "s"}.
        </p>
      ) : null}

      {trades.length === 0 ? (
        <div className="card card-pad text-center text-sm text-muted">
          {hasFilters ? "No trades match these filters." : "No trades yet. Add one or import a CSV."}
        </div>
      ) : (
        <>
          <BulkActions visible={trades.length} total={result.total} filters={filterParams} returnTo={returnTo} />
          <div className="card hidden overflow-hidden md:block">
            <table className="table">
              <thead>
                <tr>
                  <th>
                    <span className="sr-only">Select</span>
                  </th>
                  <th>{sortLabel("entryAt")}</th>
                  <th>{sortLabel("symbol")}</th>
                  <th>Side</th>
                  <th className="text-right">{sortLabel("quantity")}</th>
                  <th className="text-right">Entry</th>
                  <th className="text-right">Exit</th>
                  <th className="text-right">{sortLabel("pnl")}</th>
                  <th className="text-right">{sortLabel("rMultiple")}</th>
                  <th>Tags</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr key={t.id} className="hover:bg-surface-2">
                    <td>
                      <input type="checkbox" name="ids" value={t.id} form="bulk-delete" aria-label={`Select ${tradeLabel(t)}`} />
                    </td>
                    <td className="num whitespace-nowrap text-ink-2">{formatDateTime(t.entryAt, user.timeZone)}</td>
                    <td>
                      <Link href={`/trades/${t.id}`} className="font-semibold text-ink hover:text-accent-strong">
                        {tradeLabel(t)}
                      </Link>
                      <span className="ml-2 text-xs text-muted">{t.accountName}</span>
                    </td>
                    <td>
                      <SideBadge side={t.side} />
                    </td>
                    <td className="num text-right">{formatNumber(t.quantity, 8)}</td>
                    <td className="num text-right">{formatPrice(t.entryPrice)}</td>
                    <td className="num text-right">{formatPrice(t.exitPrice)}</td>
                    <td className="text-right">
                      <PnlFigure pnl={t.pnl} r={t.rMultiple} currency={t.currency} mode={user.displayMode} />
                    </td>
                    <td className="text-right">
                      <RMultiple value={t.rMultiple} />
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {t.tags.map((tag) => (
                          <TagChip key={tag.id} tag={tag} small />
                        ))}
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={t.status} />
                        {t.status === "OPEN" ? <CloseTrade trade={closeTarget(t, tradeLabel(t))} timeZone={user.timeZone} /> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="flex flex-col gap-2 md:hidden">
            {trades.map((t) => (
              <li key={t.id} className="card overflow-hidden">
                <Link href={`/trades/${t.id}`} className="pressable block p-3 hover:bg-surface-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="font-semibold">{tradeLabel(t)}</span>
                      <SideBadge side={t.side} />
                      {t.status === "OPEN" ? <StatusBadge status={t.status} /> : null}
                    </div>
                    <PnlFigure pnl={t.pnl} r={t.rMultiple} currency={t.currency} mode={user.displayMode} className="font-semibold" />
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs text-muted">
                    <span className="num">
                      {formatShortDate(t.entryAt, user.timeZone)} · {formatNumber(t.quantity, 8)} @ {formatPrice(t.entryPrice)}
                      {t.exitPrice ? ` → ${formatPrice(t.exitPrice)}` : ""}
                    </span>
                    <RMultiple value={t.rMultiple} />
                  </div>
                  {t.tags.length ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {t.tags.map((tag) => (
                        <TagChip key={tag.id} tag={tag} small />
                      ))}
                    </div>
                  ) : null}
                </Link>
                <div className="flex items-center justify-between border-t border-line px-3 py-2">
                  <label className="flex items-center gap-2 text-xs text-muted">
                    <input type="checkbox" name="ids" value={t.id} form="bulk-delete" aria-label={`Select ${tradeLabel(t)}`} /> Select
                  </label>
                  {t.status === "OPEN" ? <CloseTrade trade={closeTarget(t, tradeLabel(t))} timeZone={user.timeZone} /> : null}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Pagination
          page={result.page}
          pageCount={result.pageCount}
          total={result.total}
          pageSize={result.pageSize}
          hrefFor={(p) => `/trades${withParams(raw, { page: p })}`}
        />
        <div className="flex items-center gap-1 text-xs text-muted">
          <span>Per page</span>
          {PAGE_SIZES.map((size) => (
            <Link
              key={size}
              href={`/trades${withParams(raw, { pageSize: size, page: null })}`}
              className={`rounded px-1.5 py-0.5 ${result.pageSize === size ? "bg-surface-3 text-ink" : "hover:text-ink"}`}
            >
              {size}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
