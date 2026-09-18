import Link from "next/link";
import { BucketTable } from "@/components/bucket-table";
import { EdgeDecayChart } from "@/components/charts/edge-decay";
import { RHistogram } from "@/components/charts/r-histogram";
import { WeeklyAdherenceChart } from "@/components/charts/weekly-adherence";
import { PnlFigure } from "@/components/figure";
import { Pnl, RMultiple } from "@/components/pnl";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateKey, formatMoney, formatPercent, formatR } from "@/lib/format";
import { loadAdherenceReport, loadBreakdowns, loadEdgeDecay, loadLeaks, type GroupStatsDTO } from "@/lib/queries/reports";
import { isoWeekKey, isoWeekLabel } from "@/lib/weeks";

export const metadata = { title: "Reports" };

function SplitColumn({ title, stats, currency }: { title: string; stats: GroupStatsDTO; currency: string }) {
  return (
    <div className="rounded-lg border border-line bg-canvas p-3">
      <p className="text-xs font-medium text-ink-2">{title}</p>
      <p className="mt-1 text-2xl font-semibold">
        {stats.tradeCount} <span className="text-sm font-normal text-muted">trades</span>
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted">Net P&L</dt>
        <dd className="text-right">
          <Pnl value={stats.netPnl} currency={currency} />
        </dd>
        <dt className="text-muted">Expectancy</dt>
        <dd className="text-right">
          <Pnl value={stats.expectancy} currency={currency} />
        </dd>
        <dt className="text-muted">Win rate</dt>
        <dd className="num text-right">{formatPercent(stats.winRate, 0)}</dd>
        <dt className="text-muted">Expectancy (R)</dt>
        <dd className="text-right">
          <RMultiple value={stats.expectancyR} />
        </dd>
      </dl>
    </div>
  );
}

export default async function ReportsPage() {
  const user = await requireUser();
  const [report, account, decay, leaks, breakdowns] = await Promise.all([
    loadAdherenceReport(user.id, user.timeZone),
    db.account.findFirst({ where: { userId: user.id }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], select: { currency: true } }),
    loadEdgeDecay(user.id),
    loadLeaks(user.id, user.timeZone),
    loadBreakdowns(user.id, user.timeZone),
  ]);
  const currency = account?.currency ?? "USD";
  const mode = user.displayMode;
  const flagged = decay.filter((d) => d.crossedBelowZero);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="mt-1 text-sm text-muted">Process first: how well the rules were followed and what breaking them cost.</p>
        </div>
        <Link href={`/reports/week/${isoWeekKey(new Date(), user.timeZone)}`} className="btn">
          This week in review
        </Link>
      </div>

      <section className="card card-pad min-w-0" aria-label="Leak finder">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Leak finder</h2>
          <p className="text-xs text-muted">Computed from your closed trades; each finding needs at least 5 trades on both sides</p>
        </div>
        {leaks.length === 0 ? (
          <p className="text-sm text-muted">{breakdowns.closedCount < 10 ? "Needs more closed trades before patterns mean anything." : "No leak stands out. Keep logging."}</p>
        ) : (
          <ol className="divide-y divide-line">
            {leaks.map((f, i) => (
              <li key={f.key} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    <span className="num text-muted">{i + 1}.</span>
                    {f.title}
                    <span className={`badge ${f.kind === "opportunity" ? "border-accent/40 text-accent-strong" : ""}`}>{f.kind === "opportunity" ? "Opportunity" : "Leak"}</span>
                  </p>
                  <p className="mt-0.5 text-sm text-ink-2">{f.description}</p>
                  <p className="mt-1 text-xs text-muted">
                    {f.sampleSize} trade{f.sampleSize === 1 ? "" : "s"} · expectancy {formatMoney(f.groupExpectancy, { currency, signed: true })}
                    {f.restExpectancy !== null ? ` vs ${formatMoney(f.restExpectancy, { currency, signed: true })} for the rest` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end">
                  <PnlFigure pnl={f.impactPnl} r={f.impactR} currency={currency} mode={mode} className="text-lg font-semibold" noStopLabel="—" />
                  {f.addRuleHref ? (
                    <Link href={f.addRuleHref} className="btn btn-sm">
                      Add rule
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="card card-pad min-w-0" aria-label="Adherence">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Rule adherence by week</h2>
          <p className="text-xs text-muted">
            {report.overall.adherence === null ? "No checks yet" : `${formatPercent(report.overall.adherence, 0)} of ${report.overall.total} checks followed overall`}
          </p>
        </div>
        {report.ruleCount === 0 ? (
          <p className="text-sm text-muted">
            No rules yet.{" "}
            <Link href="/rules" className="text-accent underline">
              Add a rule
            </Link>{" "}
            to start measuring adherence.
          </p>
        ) : (
          <>
            <WeeklyAdherenceChart weeks={report.weekly} />
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-xs text-muted hover:text-ink">Show as table</summary>
              <table className="table mt-2">
                <thead>
                  <tr>
                    <th>Week</th>
                    <th className="text-right">Followed</th>
                    <th className="text-right">Checks</th>
                    <th className="text-right">Adherence</th>
                    <th className="text-right">Clean trades</th>
                  </tr>
                </thead>
                <tbody>
                  {report.weekly.map((w) => (
                    <tr key={w.week}>
                      <td className="num">{isoWeekLabel(w.week)}</td>
                      <td className="num text-right">{w.followed}</td>
                      <td className="num text-right">{w.total}</td>
                      <td className="num text-right">{formatPercent(w.adherence, 0)}</td>
                      <td className="num text-right">
                        {w.cleanTrades} / {w.tradeCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        )}
      </section>

      <section className="card card-pad min-w-0" aria-label="Rules followed versus broken">
        <h2 className="mb-2 text-sm font-semibold">All rules followed vs at least one broken</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <SplitColumn title="All rules followed" stats={report.clean} currency={currency} />
          <SplitColumn title="At least one broken" stats={report.broken} currency={currency} />
        </div>
      </section>

      <section className="card card-pad min-w-0 overflow-x-auto" aria-label="Cost of broken rules">
        <h2 className="mb-2 text-sm font-semibold">Cost of each rule broken</h2>
        {report.ruleCosts.length === 0 ? (
          <p className="text-sm text-muted">No rule has been broken.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Rule</th>
                <th className="text-right">Broken</th>
                <th className="text-right">Net P&L</th>
                <th className="text-right">Avg</th>
                <th className="text-right">Net R</th>
              </tr>
            </thead>
            <tbody>
              {report.ruleCosts.map((c) => (
                <tr key={c.ruleId}>
                  <td className="font-medium">{c.title}</td>
                  <td className="num text-right">{c.brokenCount}</td>
                  <td className="text-right">
                    <Pnl value={c.netPnl} currency={currency} />
                  </td>
                  <td className="num text-right text-ink-2">{formatMoney(c.avgPnl, { currency, signed: true })}</td>
                  <td className="text-right">
                    <RMultiple value={c.rCount ? c.netR : null} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card card-pad min-w-0" aria-label="Edge decay">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Edge decay per setup</h2>
          <p className="text-xs text-muted">Rolling 20-trade expectancy in R with a 95% band</p>
        </div>
        {flagged.length ? (
          <ul className="mb-3 flex flex-col gap-1">
            {flagged.map((d) => (
              <li key={d.setupId} className="rounded-lg border border-warn/40 bg-surface-2 px-3 py-2 text-sm">
                <span className="font-medium">{d.name}</span> <span className="text-ink-2">— {d.suggestion}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {decay.length === 0 ? (
          <p className="text-sm text-muted">Create setup tags and attach them to trades with stops to track the edge of each setup.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {decay.slice(0, 6).map((d) => (
              <div key={d.setupId} className="rounded-lg border border-line bg-canvas p-3">
                <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-1.5 font-medium">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: d.color }} aria-hidden />
                    {d.name}
                  </span>
                  <span className="text-xs text-muted">
                    {d.tradeCount} trade{d.tradeCount === 1 ? "" : "s"}
                    {d.latest ? ` · now ${formatR(d.latest.mean)}` : ""}
                  </span>
                </div>
                <EdgeDecayChart setup={d} timeZone={user.timeZone} />
              </div>
            ))}
          </div>
        )}
        {decay.length ? (
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer text-xs text-muted hover:text-ink">Show as table</summary>
            <table className="table mt-2">
              <thead>
                <tr>
                  <th>Setup</th>
                  <th className="text-right">Trades</th>
                  <th className="text-right">Rolling R</th>
                  <th className="text-right">95% band</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {decay.map((d) => (
                  <tr key={d.setupId}>
                    <td className="font-medium">{d.name}</td>
                    <td className="num text-right">{d.tradeCount}</td>
                    <td className="text-right">
                      <RMultiple value={d.latest?.mean ?? null} />
                    </td>
                    <td className="num text-right text-ink-2">{d.latest ? `${formatR(d.latest.lower)} to ${formatR(d.latest.upper)}` : "—"}</td>
                    <td className="text-xs text-ink-2">{d.crossedBelowZero ? "Crossed below zero" : d.latest ? (d.latest.mean < 0 ? "Negative" : "Positive") : "Too few trades"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ) : null}
      </section>

      <section className="card card-pad min-w-0" aria-label="Breakdowns">
        <h2 className="mb-1 text-sm font-semibold">Breakdowns</h2>
        <p className="mb-3 text-xs text-muted">All closed trades, by when, how long, how big and what. Tap a figure to switch units.</p>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="min-w-0 overflow-x-auto">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Hour of day</h3>
            <BucketTable rows={breakdowns.hour} currency={currency} label="Entry hour" mode={mode} />
          </div>
          <div className="min-w-0 overflow-x-auto">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Day of week</h3>
            <BucketTable rows={breakdowns.weekday} currency={currency} label="Day" mode={mode} />
          </div>
          <div className="min-w-0 overflow-x-auto">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Hold duration</h3>
            <BucketTable rows={breakdowns.hold} currency={currency} label="Held" mode={mode} />
          </div>
          <div className="min-w-0 overflow-x-auto">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
              Position size <span className="font-normal normal-case">(by {breakdowns.size.basis === "risk" ? "planned risk" : "notional value"}, tertiles)</span>
            </h3>
            <BucketTable rows={breakdowns.size.buckets} currency={currency} label="Size" mode={mode} />
          </div>
          <div className="min-w-0">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">R-multiple distribution</h3>
            <RHistogram bins={breakdowns.rBins} total={breakdowns.rTotal} />
            <details className="mt-1 text-sm">
              <summary className="cursor-pointer text-xs text-muted hover:text-ink">Show as table</summary>
              <table className="table mt-2">
                <thead>
                  <tr>
                    <th>Bin</th>
                    <th className="text-right">Trades</th>
                    <th className="text-right">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdowns.rBins.map((b) => (
                    <tr key={b.key}>
                      <td>{b.label}</td>
                      <td className="num text-right">{b.count}</td>
                      <td className="num text-right text-ink-2">{breakdowns.rTotal ? formatPercent(b.count / breakdowns.rTotal, 0) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </div>
          <div className="min-w-0 overflow-x-auto">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Instrument, side and account</h3>
            <BucketTable rows={[...breakdowns.instrument, ...breakdowns.side, ...breakdowns.account.map((a) => ({ ...a, key: `acct-${a.key}` }))]} currency={currency} label="Group" mode={mode} />
          </div>
        </div>
      </section>

      <section className="card card-pad min-w-0" aria-label="Options">
        <h2 className="mb-1 text-sm font-semibold">Options</h2>
        <p className="mb-3 text-xs text-muted">
          {breakdowns.optionCount === 0
            ? "No option trades yet. Log one with the Option asset class and it shows up here."
            : `${breakdowns.optionCount} closed option trade${breakdowns.optionCount === 1 ? "" : "s"}: calls against puts, options against shares, and how far from expiration you entered.`}
        </p>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="min-w-0 overflow-x-auto">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Calls vs puts</h3>
            <BucketTable rows={breakdowns.optionType} currency={currency} label="Type" mode={mode} empty="No option trades yet." />
          </div>
          <div className="min-w-0 overflow-x-auto">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Options vs shares</h3>
            <BucketTable rows={breakdowns.optionsVsShares} currency={currency} label="Instrument" mode={mode} empty="No closed trades yet." />
          </div>
          <div className="min-w-0 overflow-x-auto">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Days to expiration at entry</h3>
            <BucketTable rows={breakdowns.dte} currency={currency} label="DTE" mode={mode} empty="No option trades yet." />
          </div>
        </div>
      </section>

      <section className="card card-pad min-w-0" aria-label="State before the open">
        <h2 className="mb-1 text-sm font-semibold">State before the open</h2>
        <p className="mb-3 text-xs text-muted">
          Results by what you logged at check-in. {breakdowns.daysWithState} day{breakdowns.daysWithState === 1 ? "" : "s"} with a reading so far.
        </p>
        {breakdowns.daysWithState === 0 ? (
          <p className="text-sm text-muted">
            Fill in the check-in on{" "}
            <Link href="/today" className="text-accent underline">
              Today
            </Link>{" "}
            for a few sessions and this fills up.
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="min-w-0 overflow-x-auto">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Sleep</h3>
              <BucketTable rows={breakdowns.sleep} currency={currency} label="Sleep" mode={mode} />
            </div>
            <div className="min-w-0 overflow-x-auto">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Mood</h3>
              <BucketTable rows={breakdowns.mood} currency={currency} label="Mood" mode={mode} />
            </div>
            <div className="min-w-0 overflow-x-auto">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Focus</h3>
              <BucketTable rows={breakdowns.focus} currency={currency} label="Focus" mode={mode} />
            </div>
            <div className="min-w-0 overflow-x-auto">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Energy</h3>
              <BucketTable rows={breakdowns.energy} currency={currency} label="Energy" mode={mode} />
            </div>
          </div>
        )}
        <div className="mt-4 min-w-0 overflow-x-auto">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Planned vs unplanned days</h3>
          <BucketTable rows={breakdowns.planned} currency={currency} label="Days" mode={mode} empty="No closed trades yet." />
        </div>
      </section>

      <section className="card card-pad min-w-0" aria-label="Tilt ledger">
        <h2 className="mb-1 text-sm font-semibold">Tilt ledger</h2>
        <p className="mb-2 text-xs text-muted">Every broken rule with the reason given at the time. Read it before the next session.</p>
        {report.ledger.length === 0 ? (
          <p className="text-sm text-muted">Nothing here. Keep it that way.</p>
        ) : (
          <ul className="divide-y divide-line">
            {report.ledger.map((e) => (
              <li key={e.id} className="py-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="num text-xs text-muted">{formatDateKey(e.date)}</span>
                  <Link href={`/trades/${e.tradeId}`} className="font-semibold hover:text-accent-strong">
                    {e.symbol}
                  </Link>
                  <span className={`badge ${e.status === "OVERRIDDEN" ? "" : "border-warn/50 text-warn"}`}>{e.status === "OVERRIDDEN" ? "Exception" : "Broken"}</span>
                  <span className="text-ink-2">{e.ruleTitle}</span>
                  <span className="ml-auto flex items-center gap-2">
                    <RMultiple value={e.rMultiple} className="text-xs" />
                    <Pnl value={e.pnl} currency={currency} className="text-xs" />
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-ink-2">{e.justification ? `“${e.justification}”` : <span className="text-warn">No justification yet</span>}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
