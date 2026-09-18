import { PnlFigure } from "@/components/figure";
import { formatMoney, formatPercent, formatR, pnlClass } from "@/lib/format";
import type { WeekReview } from "@/lib/queries/week";

/** The weekly review card: process first, results second, one change to carry forward. */
export function WeekCard({ week, hideDollars, mode }: { week: WeekReview; hideDollars: boolean; mode: "R" | "USD" }) {
  const rOnly = hideDollars;
  const money = (v: number | null) => (rOnly ? null : v);
  return (
    <div className="card hero-card card-pad">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-xs text-ink-2">Week in review</p>
          <p className="font-display text-2xl leading-tight">{week.label}</p>
        </div>
        <p className="text-xs text-muted">
          {week.entered} trade{week.entered === 1 ? "" : "s"} entered · {week.closed} closed · {week.daysTraded} day{week.daysTraded === 1 ? "" : "s"}
        </p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <p className="text-xs text-ink-2">Net R</p>
          <p className={`figure text-3xl leading-none ${pnlClass(week.rCount ? week.netR : null)}`}>{week.rCount ? formatR(week.netR) : "—"}</p>
          {!rOnly ? <p className="mt-1 text-xs text-muted">{formatMoney(week.netPnl, { currency: week.currency, signed: true })}</p> : null}
        </div>
        <div>
          <p className="text-xs text-ink-2">Edge Score</p>
          <p className="figure text-3xl leading-none">{week.edgeScore ?? "—"}</p>
          <p className="mt-1 text-xs text-muted">last {week.edgeSample} closed trades</p>
        </div>
        <div>
          <p className="text-xs text-ink-2">Adherence</p>
          <p className="figure text-3xl leading-none">{week.adherence === null ? "—" : formatPercent(week.adherence, 0)}</p>
          <p className="mt-1 text-xs text-muted">{week.checksTotal} rule check{week.checksTotal === 1 ? "" : "s"}</p>
        </div>
        <div>
          <p className="text-xs text-ink-2">Win rate</p>
          <p className="figure text-3xl leading-none">{week.winRate === null ? "—" : formatPercent(week.winRate, 0)}</p>
          <p className="mt-1 text-xs text-muted">{week.wins} of {week.closed} closed</p>
        </div>
      </div>
      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-lg bg-canvas/60 p-3">
          <dt className="text-xs text-muted">Top setup</dt>
          <dd className="mt-0.5 font-medium">
            {week.topSetup ? (
              <>
                {week.topSetup.name} <span className={`num ${pnlClass(week.topSetup.netR)}`}>{formatR(week.topSetup.netR)}</span>{" "}
                <span className="text-xs text-muted">over {week.topSetup.count}</span>
              </>
            ) : (
              <span className="text-muted">No setup tags this week</span>
            )}
          </dd>
        </div>
        <div className="rounded-lg bg-canvas/60 p-3">
          <dt className="text-xs text-muted">Biggest leak</dt>
          <dd className="mt-0.5 font-medium">
            {week.biggestLeak ? (
              <>
                {week.biggestLeak.title}{" "}
                <PnlFigure pnl={money(week.biggestLeak.impactPnl)} r={week.biggestLeak.impactR} currency={week.currency} mode={rOnly ? "R" : mode} noStopLabel="—" className="text-sm" />
              </>
            ) : (
              <span className="text-muted">Nothing stands out</span>
            )}
          </dd>
        </div>
        <div className="rounded-lg bg-canvas/60 p-3">
          <dt className="text-xs text-muted">Journaling</dt>
          <dd className="mt-0.5 font-medium">
            {week.daysCheckedIn} check-in{week.daysCheckedIn === 1 ? "" : "s"} · {week.daysReviewed} review{week.daysReviewed === 1 ? "" : "s"} · {week.mistakesCount} mistake tag{week.mistakesCount === 1 ? "" : "s"}
            {!rOnly && week.mistakesCount ? <span className={`num ${pnlClass(week.mistakesCost)}`}> ({formatMoney(week.mistakesCost, { currency: week.currency, signed: true })})</span> : null}
          </dd>
        </div>
        <div className="rounded-lg bg-canvas/60 p-3">
          <dt className="text-xs text-muted">Best / worst day</dt>
          <dd className="mt-0.5 font-medium">
            {week.bestDay && week.worstDay ? (
              <>
                <span className={`num ${pnlClass(week.bestDay.r || week.bestDay.pnl)}`}>{rOnly || mode === "R" ? formatR(week.bestDay.r) : formatMoney(week.bestDay.pnl, { currency: week.currency, signed: true })}</span>
                {" / "}
                <span className={`num ${pnlClass(week.worstDay.r || week.worstDay.pnl)}`}>{rOnly || mode === "R" ? formatR(week.worstDay.r) : formatMoney(week.worstDay.pnl, { currency: week.currency, signed: true })}</span>
              </>
            ) : (
              <span className="text-muted">—</span>
            )}
          </dd>
        </div>
      </dl>
      {week.oneChange ? (
        <p className="mt-4 rounded-lg border border-signature/30 bg-signature-soft px-3 py-2 text-sm">
          <span className="text-xs text-muted">One change · </span>
          {week.oneChange}
        </p>
      ) : null}
    </div>
  );
}
