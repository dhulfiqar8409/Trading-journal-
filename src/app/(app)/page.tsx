import Link from "next/link";
import { BreakdownTable } from "@/components/breakdown-table";
import { CalendarHeatmap } from "@/components/calendar-heatmap";
import { DailyPnlBars } from "@/components/charts/daily-pnl";
import { EdgeRadar, EdgeTrend } from "@/components/charts/edge-radar";
import { EquityCurve } from "@/components/charts/equity-curve";
import { ThreeCurvesChart } from "@/components/charts/three-curves";
import { PnlFigure } from "@/components/figure";
import { StatTile } from "@/components/kpi";
import { Pnl, SideBadge, StatusBadge } from "@/components/pnl";
import { RangeSelector } from "@/components/range-selector";
import { RollUp } from "@/components/roll-up";
import { StreakCard } from "@/components/streak-card";
import { requireUser } from "@/lib/auth";
import { formatDateKey, formatMoney, formatPercent, formatR, formatRatio, formatShortDate } from "@/lib/format";
import { tradeLabel } from "@/lib/options";
import { loadDashboard, resolveMonth, resolveRange } from "@/lib/queries/dashboard";
import { loadStreaks } from "@/lib/queries/streaks";
import { flattenSearchParams, withParams, type SearchParams } from "@/lib/search-params";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const raw = flattenSearchParams(await searchParams);
  const range = resolveRange(raw, user.timeZone);
  const month = resolveMonth(raw.month, range, user.timeZone);
  const [data, streaks] = await Promise.all([loadDashboard(user.id, user.timeZone, range, month), loadStreaks(user.id, user.timeZone)]);
  const s = data.summary;
  const currency = data.currency;
  const mode = user.displayMode;
  const money = (v: number | null, signed = true) => formatMoney(v, { currency, signed, compact: true });
  const figure = (pnl: number | null, r: number | null) =>
    mode === "R" ? (r === null ? "—" : formatR(r)) : money(pnl);
  const stopsNote = s.rTradeCount < s.tradeCount ? `${s.rTradeCount} of ${s.tradeCount} trades have stops` : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="page-title">Dashboard</h1>
        <RangeSelector range={range} current={raw} />
      </div>

      <section className="card hero-card card-pad flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between" aria-label="Net P&L">
        <div>
          <p className="text-xs text-ink-2">{mode === "R" ? "Net R" : "Net P&L"}</p>
          <PnlFigure pnl={s.netPnl} r={s.rTradeCount ? s.netR : null} currency={currency} mode={mode} className="figure mt-1 text-4xl leading-none sm:text-5xl" noStopLabel="no stops yet" animate />
          <p className="mt-2 text-xs text-muted">
            {range.label} · {s.tradeCount} closed trade{s.tradeCount === 1 ? "" : "s"}
            {s.openCount ? ` · ${s.openCount} open` : ""}
            {stopsNote ? ` · ${stopsNote}` : ""} · tap a figure to switch units
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
        <StatTile label="Expectancy" value={figure(s.expectancy, s.expectancyR)} tone={mode === "R" ? s.expectancyR : s.expectancy} sub={mode === "R" ? "Net R per trade with a stop" : "Net P&L per closed trade"} />
        <StatTile label="Average win" value={figure(s.avgWin, s.avgWinR)} tone={s.avgWin} sub={s.largestWin !== null ? `Largest ${money(s.largestWin)}` : undefined} />
        <StatTile label="Average loss" value={figure(s.avgLoss, s.avgLossR)} tone={s.avgLoss} sub={s.largestLoss !== null ? `Largest ${money(s.largestLoss)}` : undefined} />
        <StatTile
          label="Max drawdown"
          value={mode === "R" ? (s.rTradeCount ? formatR(-s.maxDrawdownR) : "—") : money(-s.maxDrawdown, false)}
          tone={s.maxDrawdown > 0 ? -1 : 0}
          sub={mode === "R" ? "Peak to trough of cumulative R" : "Peak to trough of cumulative P&L"}
        />
        <StatTile label="Open positions" value={String(s.openCount)} sub={`${s.tradeCount} closed · ${s.rTradeCount} with stops · tap to close`} href="/trades?status=OPEN" />
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
        <EquityCurve points={data.equity} currency={currency} timeZone={user.timeZone} mode={mode} />
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

      <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
        <section className="card card-pad min-w-0" aria-label="Edge Score">
          <div className="mb-1 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Edge Score</h2>
            <p className="text-xs text-muted">Last {data.edge.sampleSize} closed trades</p>
          </div>
          {data.edge.insufficient ? (
            <p className="text-sm text-muted">
              Needs at least {data.edge.minimum} closed trades; {data.edge.sampleSize} so far.
            </p>
          ) : (
            <>
              <div className="flex items-end gap-4">
                <p className="figure text-5xl leading-none">
                  <RollUp value={data.edge.score ?? 0} />
                </p>
                <p className="pb-1 text-xs text-muted">
                  out of 100 across six factors
                  <br />
                  rolling {data.edge.window}-trade window
                </p>
              </div>
              <EdgeRadar edge={data.edge} />
              <p className="mb-1 text-xs text-muted">Score over time</p>
              <EdgeTrend trend={data.edge.trend} timeZone={user.timeZone} />
            </>
          )}
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer text-xs text-muted hover:text-ink">Show as table</summary>
            <table className="table mt-2">
              <thead>
                <tr>
                  <th>Factor</th>
                  <th className="text-right">Value</th>
                  <th className="text-right">Score</th>
                </tr>
              </thead>
              <tbody>
                {data.edge.factors.map((f) => (
                  <tr key={f.key}>
                    <td>{f.label}</td>
                    <td className="num text-right text-ink-2">
                      {f.raw === null ? "—" : f.key === "winRate" || f.key === "drawdown" || f.key === "consistency" ? formatPercent(f.raw, 0) : formatRatio(f.raw)}
                    </td>
                    <td className="num text-right">{Math.round(f.score)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted">
              Anchors: win rate 20→70%, profit factor and payoff 0.5→3, drawdown as a share of gross profit 100%→0%, recovery factor 0→5, best day 60%→10% of net.
            </p>
          </details>
        </section>

        <section className="card card-pad min-w-0" aria-label="What mistakes cost">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">What mistakes cost</h2>
            <p className="text-xs text-muted">Drag across the chart to compare</p>
          </div>
          <ThreeCurvesChart points={data.curves.points} currency={currency} timeZone={user.timeZone} mode={mode} />
          <dl className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-lg bg-canvas p-2">
              <dt className="text-muted">Actual</dt>
              <dd>
                <PnlFigure pnl={data.curves.actual} r={data.curves.actualR} currency={currency} mode={mode} className="font-semibold" />
              </dd>
            </div>
            <div className="rounded-lg bg-canvas p-2">
              <dt className="text-muted">Mistakes removed ({data.curves.removedCount})</dt>
              <dd>
                <PnlFigure pnl={data.curves.mistakesRemoved} r={data.curves.mistakesRemovedR} currency={currency} mode={mode} className="font-semibold" />
              </dd>
            </div>
            <div className="rounded-lg bg-canvas p-2">
              <dt className="text-muted">Stops honoured ({data.curves.cappedCount})</dt>
              <dd>
                <PnlFigure pnl={data.curves.stopsHonoured} r={data.curves.stopsHonouredR} currency={currency} mode={mode} className="font-semibold" />
              </dd>
            </div>
          </dl>
          {data.mistakes.length ? (
            <table className="table mt-3">
              <thead>
                <tr>
                  <th>Mistake</th>
                  <th className="text-right">Trades</th>
                  <th className="text-right">Avg</th>
                  <th className="text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {data.mistakes.map((m) => (
                  <tr key={m.tagId}>
                    <td className="font-medium">{m.name}</td>
                    <td className="num text-right text-ink-2">{m.count}</td>
                    <td className="num text-right text-ink-2">{formatMoney(m.avgPnl, { currency, signed: true })}</td>
                    <td className="text-right">
                      <PnlFigure pnl={m.netPnl} r={m.rCount ? m.netR : null} currency={currency} mode={mode} noStopLabel="no stops" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-3 text-xs text-muted">No mistake tags on closed trades in this range.</p>
          )}
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer text-xs text-muted hover:text-ink">Show curves as table</summary>
            <div className="mt-2 max-h-72 overflow-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Closed</th>
                    <th>Symbol</th>
                    <th className="text-right">Actual</th>
                    <th className="text-right">No mistakes</th>
                    <th className="text-right">Stops honoured</th>
                  </tr>
                </thead>
                <tbody>
                  {data.curves.points.map((p) => (
                    <tr key={p.tradeId}>
                      <td className="num">{formatShortDate(new Date(p.t), user.timeZone)}</td>
                      <td>{p.symbol}</td>
                      <td className="text-right">
                        <Pnl value={mode === "R" ? null : p.actual} currency={currency} />
                        {mode === "R" ? <span className="num">{formatR(p.actualR)}</span> : null}
                      </td>
                      <td className="num text-right">{mode === "R" ? formatR(p.mistakesRemovedR) : formatMoney(p.mistakesRemoved, { currency, signed: true })}</td>
                      <td className="num text-right">{mode === "R" ? formatR(p.stopsHonouredR) : formatMoney(p.stopsHonoured, { currency, signed: true })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card card-pad min-w-0">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Daily P&L</h2>
            <p className="text-xs text-muted">Net, by exit day</p>
          </div>
          <DailyPnlBars days={data.daily} currency={currency} mode={mode} />
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

        <StreakCard data={streaks} compact />

        <section className="card card-pad min-w-0 overflow-x-auto">
          <h2 className="mb-2 text-sm font-semibold">Top symbols</h2>
          <BreakdownTable rows={data.topSymbols} currency={currency} keyLabel="Symbol" empty="No closed trades in this range." mode={mode} />
        </section>

        <section className="card card-pad min-w-0 overflow-x-auto">
          <h2 className="mb-2 text-sm font-semibold">P&L by tag</h2>
          <BreakdownTable rows={data.byTag} currency={currency} keyLabel="Tag" empty="No tagged trades in this range." mode={mode} />
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
                    <span className="font-semibold">{tradeLabel(t)}</span>
                    <SideBadge side={t.side} />
                    {t.status === "OPEN" ? <StatusBadge status={t.status} /> : null}
                    <span className="num truncate text-xs text-muted">{formatShortDate(t.entryAt, user.timeZone)}</span>
                  </div>
                  <PnlFigure pnl={t.pnl} r={t.rMultiple} currency={t.currency} mode={mode} className="font-semibold" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
