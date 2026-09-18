import Link from "next/link";
import { recheckDayAction } from "@/actions/rules";
import { BudgetBars } from "@/components/budget-bar";
import { CloseTrade } from "@/components/close-trade";
import { CheckInForm, JustifyForm, ReviewForm } from "@/components/day-forms";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { Pnl, RMultiple, SideBadge, StatusBadge } from "@/components/pnl";
import { TagChip } from "@/components/tag-chip";
import { StreakCard } from "@/components/streak-card";
import { closeTarget } from "@/lib/close-target";
import { requireUser } from "@/lib/auth";
import { formatDateKey, formatDateTime, formatNumber, formatPrice, formatShortDate } from "@/lib/format";
import { tradeLabel } from "@/lib/options";
import { loadStreaks } from "@/lib/queries/streaks";
import { loadToday } from "@/lib/queries/today";
import { flattenSearchParams, type SearchParams } from "@/lib/search-params";

export const metadata = { title: "Today" };

function StatePill({ label, value }: { label: string; value: number | null }) {
  if (value === null) return null;
  return (
    <span className="badge">
      {label} <span className="num text-ink">{value}</span>
    </span>
  );
}

export default async function TodayPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const raw = flattenSearchParams(await searchParams);
  const [data, streaks] = await Promise.all([loadToday(user.id, user.timeZone, raw.date), loadStreaks(user.id, user.timeZone)]);
  const { day, budget } = data;
  const activeRules = data.rules.filter((r) => r.active);
  const brokenEvents = data.events;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title">{data.isToday ? "Today" : formatDateKey(data.dateKey)}</h1>
          <p className="mt-0.5 text-sm text-muted">
            {data.isToday ? formatDateKey(data.dateKey) : "Past day"} · {user.timeZone.replace(/_/g, " ")}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Link href={`/today?date=${data.prevKey}`} className="btn btn-sm" aria-label="Previous day">
            <ChevronLeftIcon width={16} height={16} />
          </Link>
          {!data.isToday ? (
            <Link href="/today" className="btn btn-sm">
              Today
            </Link>
          ) : null}
          <Link href={`/today?date=${data.nextKey}`} className="btn btn-sm" aria-label="Next day">
            <ChevronRightIcon width={16} height={16} />
          </Link>
        </div>
      </div>

      <section className="card card-pad" aria-label="Plan budget">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Plan budget</h2>
          <p className="num text-xs text-muted">
            Net so far <RMultiple value={budget.netR} className="font-semibold" /> · <Pnl value={budget.netPnl} currency={data.currency} />
          </p>
        </div>
        <BudgetBars budget={budget} currency={data.currency} />
      </section>

      <section className="card card-pad" aria-label="Check-in">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Check-in</h2>
          {day?.checkedInAt ? <p className="text-xs text-muted">Saved {formatDateTime(day.checkedInAt, user.timeZone)}</p> : null}
        </div>
        {day?.checkedInAt ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              <span className="badge">
                Max trades <span className="num text-ink">{day.maxTrades ?? "—"}</span>
              </span>
              <span className="badge">
                Max loss <span className="num text-ink">{day.maxLossR ? `${day.maxLossR}R` : "—"}</span>
              </span>
              <StatePill label="Mood" value={day.mood} />
              <StatePill label="Focus" value={day.focus} />
              <StatePill label="Energy" value={day.energy} />
              <StatePill label="Sleep" value={day.sleepHours} />
            </div>
            {day.allowedSetupIds.length ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {data.setups
                  .filter((s) => day.allowedSetupIds.includes(s.id))
                  .map((s) => (
                    <TagChip key={s.id} tag={s} small />
                  ))}
              </div>
            ) : null}
            {day.focusNote ? <p className="mt-2 text-sm text-ink-2">{day.focusNote}</p> : null}
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-muted hover:text-ink">Edit check-in</summary>
              <div className="mt-3">
                <CheckInForm dateKey={data.dateKey} day={day} setups={data.setups} />
              </div>
            </details>
          </>
        ) : (
          <>
            <p className="mb-3 text-sm text-muted">Set the plan and note how you feel before the open. It takes a minute and powers the budget bar.</p>
            <CheckInForm dateKey={data.dateKey} day={day} setups={data.setups} />
          </>
        )}
      </section>

      <section className="card card-pad" aria-label="Trades">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Trades {data.isToday ? "so far" : "that day"}</h2>
          <Link href="/trades/new" className="text-xs text-accent hover:text-accent-strong">
            New trade
          </Link>
        </div>
        {data.trades.length === 0 ? (
          <p className="text-sm text-muted">No trades yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.trades.map((t) => {
              const broken = t.ruleEvents.filter((e) => e.status !== "FOLLOWED").length;
              return (
                <li key={t.id} className="flex items-center gap-2">
                  <Link href={`/trades/${t.id}`} className="flex min-w-0 flex-1 items-center justify-between gap-3 py-2 hover:bg-surface-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="font-semibold">{tradeLabel(t)}</span>
                      <SideBadge side={t.side} />
                      {t.status === "OPEN" ? <StatusBadge status={t.status} /> : null}
                      <span className="num text-xs text-muted">{formatDateTime(t.entryAt, user.timeZone).slice(-5)}</span>
                      {t.ruleEvents.length ? (
                        <span className={`badge ${broken ? "border-warn/50 text-warn" : ""}`}>{broken ? `${broken} rule${broken === 1 ? "" : "s"} broken` : "Rules ok"}</span>
                      ) : null}
                    </div>
                    <div className="text-right">
                      <RMultiple value={t.rMultiple} className="block font-semibold" />
                      <Pnl value={t.pnl} currency={t.currency} className="block text-xs" />
                    </div>
                  </Link>
                  {t.status === "OPEN" ? <CloseTrade trade={closeTarget(t, tradeLabel(t))} timeZone={user.timeZone} /> : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card card-pad" aria-label="Open positions">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Open positions</h2>
          <Link href="/trades?status=OPEN" className="text-xs text-accent hover:text-accent-strong">
            All open trades
          </Link>
        </div>
        {data.openPositions.length === 0 ? (
          <p className="text-sm text-muted">No open positions.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.openPositions.map((t) => (
              <li key={t.id} className="flex items-center gap-2">
                <Link href={`/trades/${t.id}`} className="flex min-w-0 flex-1 flex-wrap items-center gap-2 py-2 hover:bg-surface-2">
                  <span className="font-semibold">{tradeLabel(t)}</span>
                  <SideBadge side={t.side} />
                  <span className="num text-xs text-muted">
                    {formatNumber(t.quantity, 8)} @ {formatPrice(t.entryPrice)} · since {formatShortDate(t.entryAt, user.timeZone)}
                  </span>
                </Link>
                <CloseTrade trade={closeTarget(t, tradeLabel(t))} timeZone={user.timeZone} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card card-pad" aria-label="Rule events">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">Rule events</h2>
          <p className="text-xs text-muted">
            {activeRules.length} active rule{activeRules.length === 1 ? "" : "s"} · {data.followedCount} followed · {brokenEvents.length} broken
          </p>
        </div>
        {activeRules.length === 0 ? (
          <p className="text-sm text-muted">
            No rules yet.{" "}
            <Link href="/rules" className="text-accent underline">
              Add your first rule
            </Link>
            .
          </p>
        ) : brokenEvents.length === 0 ? (
          <p className="text-sm text-muted">Every rule followed {data.isToday ? "so far" : "that day"}.</p>
        ) : (
          <ul className="divide-y divide-line">
            {brokenEvents.map((e) => (
              <li key={e.id} className="py-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className={`badge ${e.status === "OVERRIDDEN" ? "" : "border-warn/50 text-warn"}`}>{e.status === "OVERRIDDEN" ? "Exception" : "Broken"}</span>
                  <span className="font-medium">{e.ruleTitle}</span>
                  <Link href={`/trades/${e.tradeId}`} className="text-accent hover:text-accent-strong">
                    {e.symbol}
                  </Link>
                </div>
                {e.justification ? <p className="mt-1 text-sm text-ink-2">“{e.justification}”</p> : <JustifyForm eventId={e.id} />}
              </li>
            ))}
          </ul>
        )}
        {activeRules.length > 0 && data.trades.length > 0 ? (
          <form action={recheckDayAction.bind(null, data.dateKey)} className="mt-3">
            <button type="submit" className="btn btn-sm">
              Re-check rules for this day
            </button>
          </form>
        ) : null}
      </section>

      <StreakCard data={streaks} />

      <section className="card card-pad" aria-label="Review">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">End-of-day review</h2>
          {day?.reviewedAt ? <p className="text-xs text-muted">Saved {formatDateTime(day.reviewedAt, user.timeZone)}</p> : null}
        </div>
        {day?.reviewedAt ? (
          <>
            <dl className="grid gap-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-muted">Went right</dt>
                <dd className="whitespace-pre-wrap text-ink-2">{day.wentRight || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Went wrong</dt>
                <dd className="whitespace-pre-wrap text-ink-2">{day.wentWrong || "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">One change</dt>
                <dd className="whitespace-pre-wrap text-ink-2">{day.oneChange || "—"}</dd>
              </div>
            </dl>
            {day.dayTags.length ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {day.dayTags.map((t) => (
                  <span key={t} className="badge">
                    {t}
                  </span>
                ))}
              </div>
            ) : null}
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-muted hover:text-ink">Edit review</summary>
              <div className="mt-3">
                <ReviewForm dateKey={data.dateKey} day={day} />
              </div>
            </details>
          </>
        ) : (
          <ReviewForm dateKey={data.dateKey} day={day} />
        )}
      </section>
    </div>
  );
}
