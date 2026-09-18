import Link from "next/link";
import { BreakdownTable } from "@/components/breakdown-table";
import { CalendarHeatmap } from "@/components/calendar-heatmap";
import { DailyPnlBars } from "@/components/charts/daily-pnl";
import { EquityCurve } from "@/components/charts/equity-curve";
import { StatTile } from "@/components/kpi";
import { Pnl, SideBadge, StatusBadge } from "@/components/pnl";
import { RangeSelector } from "@/components/range-selector";
import { requireUser } from "@/lib/auth";
import { formatDateKey, formatMoney, formatPercent, formatRatio, formatShortDate, pnlClass } from "@/lib/format";
import { loadDashboard, resolveMonth, resolveRange } from "@/lib/queries/dashboard";
import { flattenSearchParams, withParams, type SearchParams } from "@/lib/search-params";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const raw = flattenSearchParams(await searchParams);
  const range = resolveRange(raw, user.timeZone);
  const month = resolveMonth(raw.month, range, user.timeZone);
  const data = await loadDashboard(user.id, user.timeZone, range, month);
  const s = data.summary;
  const currency = data.currency;
  const money = (v: number | null, signed = true) => formatMoney(v, { currency, signed, compact: true });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <RangeSelector range={range} current={raw} />
      </div>

      <section className="card card-pad flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between" aria-label="Net P&L">
        <div>
          <p className="text-xs text-ink-2">Net P&L</p>
          <p className={`mt-1 text-4xl font-semibold leading-none sm:text-5xl ${pnlClass(s.netPnl)}`}>{money(s.netPnl)}</p>
          <p className="mt-2 text-xs text-muted">
            {range.label} · {s.tradeCount} closed trade{s.tradeCount === 1 ? "" : "s"}
            {s.openCount ? ` · ${s.openCount} open` : ""}
          </p>
        </div>
        <dl className="grid grid-cols-3 gap-4 text-sm sm:text-right">
          <div>
            <dt className="text-xs text-muted">Gross profit</dt>
            <dd className="num font-semibold text-profit">{money(s.grossProfit, false)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Gross loss</dt>
            <dd className="num font-semibold text-loss">{money(s.grossLoss, false)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">W / L / BE</dt>
            <dd className="num font-semibold text-ink">
              {s.wins} / {s.losses} / {s.breakeven}
            </dd>
          </div>
        </dl>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Key figures">
        <StatTile label="Win rate" value={formatPercent(s.winRate, 0)} sub={`${s.wins} of ${s.tradeCount} closed trades`} />
        <StatTile
          label="Profit factor"
          value={s.profitFactor === null ? (s.grossProfit > 0 ? "∞" : "—") : formatRatio(s.profitFactor)}
          sub="Gross profit ÷ gross loss"
        />
        <StatTile label="Expectancy" value={money(s.expectancy)} tone={s.expectancy} sub="Net P&L per closed trade" />
        <StatTile label="Average win" value={money(s.avgWin)} tone={s.avgWin} sub={s.largestWin !== null ? `Largest ${money(s.largestWin)}` : undefined} />
        <StatTile label="Average loss" value={money(s.avgLoss)} tone={s.avgLoss} sub={s.largestLoss !== null ? `Largest ${money(s.largestLoss)}` : undefined} />
        <StatTile label="Max drawdown" value={money(-s.maxDrawdown, false)} tone={s.maxDrawdown > 0 ? -1 : 0} sub="Peak to trough of cumulative P&L" />
        <StatTile label="Trades" value={String(s.tradeCount)} sub={`${s.openCount} open position${s.openCount === 1 ? "" : "s"}`} />
        <StatTile
          label="Streak"
          value={s.streak.kind === "NONE" ? "—" : `${s.streak.length} ${s.streak.kind === "WIN" ? "win" : "loss"}${s.streak.length === 1 ? "" : s.streak.kind === "WIN" ? "s" : "es"}`}
          tone={s.streak.kind === "WIN" ? 1 : s.streak.kind === "LOSS" ? -1 : 0}
          sub="Most recent closed trades"
        />
      </section>

      <section className="card card-pad min-w-0">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Equity curve</h2>
          <p className="text-xs text-muted">Cumulative net P&L by exit time</p>
        </div>
        <EquityCurve points={data.equity} currency={currency} timeZone={user.timeZone} />
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-xs text-muted hover:text-ink">Show as table</summary>
          {data.equity.length ? (
            <div className="mt-2 max-h-72 overflow-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Closed</th>
                    <th>Symbol</th>
                    <th className="text-right">Trade</th>
                    <th className="text-right">Cumulative</th>
                  </tr>
                </thead>
                <tbody>
                  {data.equity.map((p) => (
                    <tr key={p.tradeId}>
                      <td className="num">{formatShortDate(new Date(p.t), user.timeZone)}</td>
                      <td>
                        <Link href={`/trades/${p.tradeId}`} className="hover:text-accent-strong">
                          {p.symbol}
                        </Link>
                      </td>
                      <td className="text-right">
                        <Pnl value={p.pnl} currency={currency} />
                      </td>
                      <td className="text-right">
                        <Pnl value={p.cumulative} currency={currency} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </details>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card card-pad min-w-0">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Daily P&L</h2>
            <p className="text-xs text-muted">Net, by exit day</p>
          </div>
          <DailyPnlBars days={data.daily} currency={currency} />
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer text-xs text-muted hover:text-ink">Show as table</summary>
            {data.daily.length ? (
              <div className="mt-2 max-h-72 overflow-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th className="text-right">Trades</th>
                      <th className="text-right">Net P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.daily.map((d) => (
                      <tr key={d.date}>
                        <td className="num">{formatDateKey(d.date)}</td>
                        <td className="num text-right">{d.tradeCount}</td>
                        <td className="text-right">
                          <Pnl value={d.pnl} currency={currency} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </details>
        </section>

        <section className="card card-pad min-w-0">
          <h2 className="mb-2 text-sm font-semibold">Calendar</h2>
          <CalendarHeatmap calendar={data.calendar} currency={currency} hrefFor={(m) => `/${withParams(raw, { month: m })}`} />
        </section>

        <section className="card card-pad min-w-0 overflow-x-auto">
          <h2 className="mb-2 text-sm font-semibold">Top symbols</h2>
          <BreakdownTable rows={data.topSymbols} currency={currency} keyLabel="Symbol" empty="No closed trades in this range." />
        </section>

        <section className="card card-pad min-w-0 overflow-x-auto">
          <h2 className="mb-2 text-sm font-semibold">P&L by tag</h2>
          <BreakdownTable rows={data.byTag} currency={currency} keyLabel="Tag" empty="No tagged trades in this range." />
        </section>
      </div>

      <section className="card card-pad">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Recent trades</h2>
          <Link href="/trades" className="text-xs text-accent hover:text-accent-strong">
            All trades
          </Link>
        </div>
        {data.recent.length === 0 ? (
          <p className="text-sm text-muted">
            No trades yet.{" "}
            <Link href="/trades/new" className="text-accent underline">
              Add your first trade
            </Link>{" "}
            or{" "}
            <Link href="/import" className="text-accent underline">
              import a CSV
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {data.recent.map((t) => (
              <li key={t.id}>
                <Link href={`/trades/${t.id}`} className="flex items-center justify-between gap-3 py-2 hover:bg-surface-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="font-semibold">{t.symbol}</span>
                    <SideBadge side={t.side} />
                    {t.status === "OPEN" ? <StatusBadge status={t.status} /> : null}
                    <span className="num truncate text-xs text-muted">{formatShortDate(t.entryAt, user.timeZone)}</span>
                  </div>
                  <Pnl value={t.pnl} currency={t.currency} className="font-semibold" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
