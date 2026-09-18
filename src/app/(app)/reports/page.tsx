import Link from "next/link";
import { EdgeDecayChart } from "@/components/charts/edge-decay";
import { WeeklyAdherenceChart } from "@/components/charts/weekly-adherence";
import { Pnl, RMultiple } from "@/components/pnl";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateKey, formatMoney, formatPercent, formatR } from "@/lib/format";
import { loadAdherenceReport, loadEdgeDecay, type GroupStatsDTO } from "@/lib/queries/reports";
import { isoWeekLabel } from "@/lib/weeks";

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
  const [report, account, decay] = await Promise.all([
    loadAdherenceReport(user.id, user.timeZone),
    db.account.findFirst({ where: { userId: user.id }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], select: { currency: true } }),
    loadEdgeDecay(user.id),
  ]);
  const currency = account?.currency ?? "USD";
  const flagged = decay.filter((d) => d.crossedBelowZero);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Reports</h1>
        <p className="mt-1 text-sm text-muted">Process first: how well the rules were followed and what breaking them cost.</p>
      </div>

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
